#include "vg_net.h"

#include <stdlib.h>
#include <string.h>

#include "esp_app_desc.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "vg_identity.h"
#include "vg_proof.h"
#include "vg_provisioning.h"
#include "wifi_provisioning/manager.h"
#include "wifi_provisioning/scheme_ble.h"

static const char *TAG = "vg_net";

/**
 * Endpoint the app reads before it sends credentials, to confirm it is
 * provisioning the gateway the user scanned. Runs inside the encrypted
 * provisioning session, so it is not a way to enumerate serial numbers over
 * the air: reaching it requires the proof of possession.
 */
#define VG_NET_IDENTITY_ENDPOINT "vg-identity"

/**
 * Connection attempts the provisioning manager makes before it reports a
 * failure to the phone. Bounded rather than infinite so that a session ends
 * with an answer -- "that did not work" is a better outcome for someone
 * standing there with a phone than an indefinite wait.
 */
#define VG_NET_SESSION_CONN_ATTEMPTS 3

/** Grace period so a phone receives the success reply before BLE stops. */
#define VG_NET_PROV_CLEANUP_DELAY_MS 1000

/** Lets the log drain before a reboot, purely so the reason is readable. */
#define VG_NET_REBOOT_DELAY_MS 200

ESP_EVENT_DEFINE_BASE(VG_NET_EVENT);

enum {
  VG_NET_EVENT_FACTORY_RESET,
  VG_NET_EVENT_RETRY_ELAPSED,
};

/*
 * Everything below is touched only from the default event loop task. The
 * two sources that are not -- the reset control and the retry timer -- post
 * events instead of reaching in, so none of this needs a lock.
 */
static vg_prov_ctx_t s_prov;
static vg_factory_identity_t s_identity;
static char s_service_name[VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE];
static esp_timer_handle_t s_retry_timer;
static bool s_wifi_started;
static bool s_manager_ready;

static const char *firmware_version(void) {
  const esp_app_desc_t *description = esp_app_get_description();
  return description != NULL ? description->version : "";
}

/* --- identity endpoint -------------------------------------------------- */

static esp_err_t identity_endpoint(uint32_t session_id, const uint8_t *inbuf, ssize_t inlen,
                                   uint8_t **outbuf, ssize_t *outlen, void *priv_data) {
  (void)session_id;
  (void)inbuf;
  (void)inlen;
  (void)priv_data;

  char body[VG_IDENTITY_DESCRIBE_BUFFER_SIZE];
  int length = vg_identity_describe(body, sizeof(body), s_identity.serial_number,
                                    firmware_version());
  if (length < 0) {
    ESP_LOGE(TAG, "identity response could not be built");
    return ESP_FAIL;
  }

  /* protocomm takes ownership of this buffer and frees it. */
  *outbuf = malloc((size_t)length);
  if (*outbuf == NULL) {
    return ESP_ERR_NO_MEM;
  }
  memcpy(*outbuf, body, (size_t)length);
  *outlen = length;
  return ESP_OK;
}

/* --- actions ------------------------------------------------------------ */

static void start_provisioning(void) {
  if (!s_manager_ready) {
    ESP_LOGE(TAG, "provisioning requested with no manager");
    return;
  }

  /* Auto-stop is disabled so that provisioning ends when the state machine
   * says it does, after the connection has actually proved itself, rather
   * than at a moment the manager picks. */
  ESP_ERROR_CHECK(wifi_prov_mgr_disable_auto_stop(VG_NET_PROV_CLEANUP_DELAY_MS));
  ESP_ERROR_CHECK(wifi_prov_mgr_endpoint_create(VG_NET_IDENTITY_ENDPOINT));

  ESP_LOGI(TAG, "advertising as %s", s_service_name);
  ESP_ERROR_CHECK(wifi_prov_mgr_start_provisioning(WIFI_PROV_SECURITY_1,
                                                   s_identity.provisioning_pop, s_service_name,
                                                   NULL));

  ESP_ERROR_CHECK(
      wifi_prov_mgr_endpoint_register(VG_NET_IDENTITY_ENDPOINT, identity_endpoint, NULL));
}

static void stop_provisioning(void) {
  if (!s_manager_ready) {
    return;
  }
  ESP_LOGI(TAG, "provisioning complete; closing the BLE service");
  wifi_prov_mgr_stop_provisioning();
}

static void connect_wifi(void) {
  if (!s_wifi_started) {
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
    /* The association is issued on WIFI_EVENT_STA_START; esp_wifi_connect
     * before the driver reports itself started is not valid. */
    return;
  }
  esp_err_t err = esp_wifi_connect();
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "connect refused: %s", esp_err_to_name(err));
  }
}

static void discard_credentials(void) {
  /* Clears the configuration the phone just sent and returns the manager to
   * its listening state, so the same session can try again. */
  esp_err_t err = wifi_prov_mgr_reset_sm_state_on_failure();
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "could not reset the provisioning session: %s", esp_err_to_name(err));
  }
}

static void erase_credentials(void) {
  /* The marker goes first. If power is lost between the two, the device comes
   * back with credentials and no proof, which the state machine already
   * treats as unusable -- whereas the other order would leave a proof
   * standing for credentials that no longer exist. */
  vg_proof_clear();

  /* esp_wifi_restore rather than the provisioning manager's reset, because
   * this also runs long after provisioning has been torn down. */
  esp_err_t err = esp_wifi_restore();
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "could not erase stored credentials: %s", esp_err_to_name(err));
    return;
  }
  ESP_LOGW(TAG, "stored Wi-Fi credentials erased");
}

static void arm_retry_timer(uint32_t delay_ms) {
  esp_timer_stop(s_retry_timer);
  ESP_ERROR_CHECK(esp_timer_start_once(s_retry_timer, (uint64_t)delay_ms * 1000ULL));
  ESP_LOGI(TAG, "retrying in %ums", (unsigned)delay_ms);
}

static void apply(vg_prov_outcome_t outcome) {
  if (outcome.has_failure) {
    ESP_LOGW(TAG, "Wi-Fi attempt failed (%s)", vg_prov_fail_reason_name(outcome.failure));
  }

  if (outcome.actions & VG_PROV_ACTION_SESSION_DOWN) {
    /* VG-006 seam: the cloud session client is torn down here. */
    ESP_LOGI(TAG, "network down");
  }
  if (outcome.actions & VG_PROV_ACTION_MARK_UNPROVEN) {
    /* Credentials are already on flash by the time this runs -- ESP-IDF wrote
     * them on receipt -- so this is what stops a power loss in the next few
     * seconds from leaving them indistinguishable from working ones. */
    vg_proof_clear();
  }
  if (outcome.actions & VG_PROV_ACTION_COMMIT_CREDENTIALS) {
    /* The write that makes the difference across a reboot. ESP-IDF stored the
     * credentials when they arrived; this records that they then produced an
     * address, which is the only durable evidence they work. */
    if (vg_proof_set() == ESP_OK) {
      ESP_LOGI(TAG, "credentials accepted");
    } else {
      /* The device is connected and useful right now, and will come back
       * unprovisioned rather than stuck. Failing loudly beats pretending. */
      ESP_LOGE(TAG, "connected, but could not record the credentials as proven");
    }
  }
  if (outcome.actions & VG_PROV_ACTION_STOP_PROVISIONING) {
    stop_provisioning();
  }
  if (outcome.actions & VG_PROV_ACTION_DISCARD_CREDENTIALS) {
    discard_credentials();
  }
  if (outcome.actions & VG_PROV_ACTION_ERASE_CREDENTIALS) {
    erase_credentials();
  }
  if (outcome.actions & VG_PROV_ACTION_START_PROVISIONING) {
    start_provisioning();
  }
  if (outcome.actions & VG_PROV_ACTION_CONNECT_WIFI) {
    connect_wifi();
  }
  if (outcome.actions & VG_PROV_ACTION_ARM_RETRY_TIMER) {
    arm_retry_timer(outcome.retry_delay_ms);
  }
  if (outcome.actions & VG_PROV_ACTION_SESSION_UP) {
    /* VG-006 seam: the cloud session client is started here. */
    ESP_LOGI(TAG, "network up");
  }
  if (outcome.actions & VG_PROV_ACTION_REBOOT) {
    ESP_LOGW(TAG, "restarting into provisioning");
    vTaskDelay(pdMS_TO_TICKS(VG_NET_REBOOT_DELAY_MS));
    esp_restart();
  }
}

static void feed(const vg_prov_event_t *event) {
  vg_prov_state_t before = s_prov.state;
  vg_prov_outcome_t outcome = vg_prov_handle(&s_prov, event);
  if (s_prov.state != before) {
    ESP_LOGI(TAG, "%s -> %s", vg_prov_state_name(before), vg_prov_state_name(s_prov.state));
  }
  apply(outcome);
}

/* --- events ------------------------------------------------------------- */

/**
 * Classifies a disconnection the way the ESP-IDF provisioning manager does,
 * so the two halves of the system agree on what "the password is wrong"
 * looks like.
 */
static vg_prov_fail_reason_t classify(uint8_t reason) {
  switch (reason) {
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_MIC_FAILURE:
      return VG_PROV_FAIL_AUTH;
    case WIFI_REASON_NO_AP_FOUND:
      return VG_PROV_FAIL_AP_NOT_FOUND;
    default:
      return VG_PROV_FAIL_TRANSIENT;
  }
}

static vg_prov_fail_reason_t session_failure_reason(void) {
  wifi_prov_sta_fail_reason_t reason;
  /* Asked for directly rather than taken from the event payload: the payload
   * carries the reason recorded before this failure was classified. */
  if (wifi_prov_mgr_get_wifi_disconnect_reason(&reason) != ESP_OK) {
    return VG_PROV_FAIL_TRANSIENT;
  }
  switch (reason) {
    case WIFI_PROV_STA_AUTH_ERROR:
      return VG_PROV_FAIL_AUTH;
    case WIFI_PROV_STA_AP_NOT_FOUND:
      return VG_PROV_FAIL_AP_NOT_FOUND;
    default:
      return VG_PROV_FAIL_TRANSIENT;
  }
}

static void on_provisioning_event(int32_t id) {
  switch (id) {
    case WIFI_PROV_CRED_RECV: {
      ESP_LOGI(TAG, "credentials received");
      vg_prov_event_t event = {.type = VG_PROV_EVENT_CREDENTIALS_RECEIVED};
      feed(&event);
      break;
    }
    case WIFI_PROV_CRED_FAIL: {
      vg_prov_event_t event = {.type = VG_PROV_EVENT_WIFI_FAILED,
                               .reason = session_failure_reason()};
      feed(&event);
      break;
    }
    case WIFI_PROV_CRED_SUCCESS:
      /* The transition is driven by the IP address, not by this: a device
       * that associated but never got an address is not on the network. */
      ESP_LOGI(TAG, "provisioning reported success");
      break;
    case WIFI_PROV_END:
      wifi_prov_mgr_deinit();
      s_manager_ready = false;
      ESP_LOGI(TAG, "provisioning service released");
      break;
    default:
      break;
  }
}

static void on_wifi_event(int32_t id, void *data) {
  switch (id) {
    case WIFI_EVENT_STA_START:
      s_wifi_started = true;
      /* During a provisioning session the manager issues the association
       * itself, once it has credentials to use. */
      if (s_prov.state == VG_PROV_STATE_CONNECTING && !s_prov.in_provisioning_session) {
        esp_wifi_connect();
      }
      break;
    case WIFI_EVENT_STA_DISCONNECTED: {
      const wifi_event_sta_disconnected_t *disconnected =
          (const wifi_event_sta_disconnected_t *)data;
      if (s_prov.in_provisioning_session) {
        /* The manager retries these on its own and reports the outcome as
         * WIFI_PROV_CRED_FAIL. Acting on both would cut its retries short. */
        ESP_LOGD(TAG, "disconnect during provisioning (reason %u)",
                 (unsigned)disconnected->reason);
        break;
      }
      vg_prov_event_t event = {.type = VG_PROV_EVENT_WIFI_FAILED,
                               .reason = classify(disconnected->reason)};
      feed(&event);
      break;
    }
    default:
      break;
  }
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
  (void)arg;

  if (base == WIFI_PROV_EVENT) {
    on_provisioning_event(id);
  } else if (base == WIFI_EVENT) {
    on_wifi_event(id, data);
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    const ip_event_got_ip_t *got_ip = (const ip_event_got_ip_t *)data;
    ESP_LOGI(TAG, "address " IPSTR, IP2STR(&got_ip->ip_info.ip));
    vg_prov_event_t event = {.type = VG_PROV_EVENT_WIFI_CONNECTED};
    feed(&event);
  } else if (base == VG_NET_EVENT) {
    vg_prov_event_t event = {.type = id == VG_NET_EVENT_FACTORY_RESET
                                         ? VG_PROV_EVENT_FACTORY_RESET
                                         : VG_PROV_EVENT_RETRY_ELAPSED};
    feed(&event);
  }
}

static void on_retry_timer(void *arg) {
  (void)arg;
  ESP_ERROR_CHECK(esp_event_post(VG_NET_EVENT, VG_NET_EVENT_RETRY_ELAPSED, NULL, 0, portMAX_DELAY));
}

/* --- startup ------------------------------------------------------------ */

esp_err_t vg_net_request_factory_reset(void) {
  return esp_event_post(VG_NET_EVENT, VG_NET_EVENT_FACTORY_RESET, NULL, 0, portMAX_DELAY);
}

esp_err_t vg_net_start(const vg_factory_identity_t *identity) {
  if (identity == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  s_identity = *identity;
  if (!vg_identity_service_name(s_service_name, sizeof(s_service_name),
                                s_identity.serial_number)) {
    return ESP_ERR_INVALID_ARG;
  }

  vg_prov_init(&s_prov);

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();

  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_PROV_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(VG_NET_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));

  const esp_timer_create_args_t timer_args = {
      .callback = on_retry_timer,
      .name = "vg_retry",
  };
  ESP_ERROR_CHECK(esp_timer_create(&timer_args, &s_retry_timer));

  wifi_init_config_t wifi_config = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&wifi_config));

  const wifi_prov_mgr_config_t manager_config = {
      .scheme = wifi_prov_scheme_ble,
      /* Releases the Bluetooth controller once provisioning is done. The
       * memory is worth more to the audio path (VG-018) than a radio nobody
       * uses again, and re-entering provisioning is a reboot by design. */
      .scheme_event_handler = WIFI_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM,
      .app_event_handler = WIFI_PROV_EVENT_HANDLER_NONE,
      .wifi_prov_conn_cfg = {.wifi_conn_attempts = VG_NET_SESSION_CONN_ATTEMPTS},
  };
  ESP_ERROR_CHECK(wifi_prov_mgr_init(manager_config));
  s_manager_ready = true;

  /*
   * Two questions, not one. `wifi_prov_mgr_is_provisioned` reports whether
   * credentials are on flash, which ESP-IDF writes the moment a phone sends
   * them; `vg_proof_read` reports whether they were ever shown to work. Only
   * the pair means provisioned, and the state machine decides what to do with
   * anything else.
   */
  bool stored = false;
  ESP_ERROR_CHECK(wifi_prov_mgr_is_provisioned(&stored));

  bool proven = false;
  if (vg_proof_read(&proven) != ESP_OK) {
    /* Unreadable is treated as unproven: re-provisioning costs a minute with
     * a phone, and the alternative is a device retrying credentials nobody
     * has established work. */
    proven = false;
  }

  if (stored && proven) {
    /* Nothing to provision, so the BLE stack is handed back immediately
     * rather than left listening for the life of the device. */
    wifi_prov_mgr_deinit();
    s_manager_ready = false;
  }

  ESP_LOGI(TAG, "serial %s, firmware %s, credentials %s", s_identity.serial_number,
           firmware_version(),
           stored ? (proven ? "stored and proven" : "stored but never connected") : "absent");

  vg_prov_event_t event = {
      .type = VG_PROV_EVENT_BOOT, .credentials_stored = stored, .credentials_proven = proven};
  feed(&event);
  return ESP_OK;
}
