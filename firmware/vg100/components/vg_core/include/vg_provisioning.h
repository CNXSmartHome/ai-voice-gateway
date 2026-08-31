/*
 * Provisioning policy for the VG-100 gateway (VG-007).
 *
 * This is the part of provisioning that makes decisions: when to advertise
 * over BLE, when to trust a set of Wi-Fi credentials enough to keep them,
 * how long to wait before trying again, and when to give up and let someone
 * start over. It is deliberately free of ESP-IDF, FreeRTOS, and the Wi-Fi
 * stack, so it can be compiled and tested with a host compiler -- see
 * `test/host`. The ESP-IDF side lives in `main/vg_net.c` and does only what
 * this file tells it to.
 *
 * The division of labour with the ESP-IDF provisioning manager matters:
 * while a provisioning session is open, the manager owns the Wi-Fi
 * connection attempt, including how many times to retry a transient failure
 * (`wifi_prov_conn_cfg.wifi_conn_attempts`). It reports back only when it
 * has given up. Once provisioning is over, this state machine owns the
 * connection for the life of the device.
 */
#ifndef VG_PROVISIONING_H
#define VG_PROVISIONING_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** First reconnect delay after losing a working network. */
#define VG_PROV_BACKOFF_INITIAL_MS 1000u

/**
 * Longest reconnect delay. A gateway is a fixed appliance with nobody
 * watching it, so retrying forever at a slow rate is right; there is no
 * failure state to escalate to and nothing to escalate to it.
 */
#define VG_PROV_BACKOFF_MAX_MS 60000u

/**
 * Consecutive authentication failures on stored credentials before the
 * device erases them and reboots into provisioning.
 *
 * The case this exists for is a router whose password changed. Without it,
 * a ceiling-mounted gateway needs physical access to a reset button to
 * recover from something the owner did on their phone. Authentication
 * failures are specific enough to act on -- a router that is switched off
 * reports something else, and is retried forever instead.
 */
#define VG_PROV_REPROVISION_AFTER_AUTH_FAILURES 5u

typedef enum {
  /** Nothing has happened yet; the device has not reported its stored state. */
  VG_PROV_STATE_BOOT = 0,
  /** BLE is advertising and waiting for a phone. */
  VG_PROV_STATE_PROVISIONING,
  /** A Wi-Fi association is in progress. */
  VG_PROV_STATE_CONNECTING,
  /** Associated, with an IP address. */
  VG_PROV_STATE_CONNECTED,
  /** Waiting out a backoff before the next attempt. */
  VG_PROV_STATE_RETRY_WAIT,
} vg_prov_state_t;

typedef enum {
  /** Boot-time report of whether credentials are already stored. */
  VG_PROV_EVENT_BOOT = 0,
  /** A phone delivered credentials over the provisioning session. */
  VG_PROV_EVENT_CREDENTIALS_RECEIVED,
  /** Associated and holding an IP address. */
  VG_PROV_EVENT_WIFI_CONNECTED,
  /** An attempt failed, or a working connection dropped. */
  VG_PROV_EVENT_WIFI_FAILED,
  /** The backoff armed by VG_PROV_ACTION_ARM_RETRY_TIMER has elapsed. */
  VG_PROV_EVENT_RETRY_ELAPSED,
  /** The reset control was held down long enough to mean it. */
  VG_PROV_EVENT_FACTORY_RESET,
} vg_prov_event_type_t;

typedef enum {
  /** Anything that might fix itself: no AP in range, DHCP timeout, a reboot. */
  VG_PROV_FAIL_TRANSIENT = 0,
  /** The password is wrong. Retrying it will not help. */
  VG_PROV_FAIL_AUTH,
  /** The SSID was not found. During provisioning, usually a typo. */
  VG_PROV_FAIL_AP_NOT_FOUND,
} vg_prov_fail_reason_t;

typedef struct {
  vg_prov_event_type_t type;
  /** VG_PROV_EVENT_BOOT: whether stored credentials exist. */
  bool has_credentials;
  /** VG_PROV_EVENT_WIFI_FAILED: why. Ignored for other events. */
  vg_prov_fail_reason_t reason;
} vg_prov_event_t;

/**
 * What the caller must do. A single transition can require several, so these
 * are bit flags combined in `vg_prov_outcome_t.actions`.
 */
typedef enum {
  VG_PROV_ACTION_NONE = 0,
  /** Start BLE advertising and accept a provisioning session. */
  VG_PROV_ACTION_START_PROVISIONING = 1u << 0,
  /** Close the provisioning service and release the radio. */
  VG_PROV_ACTION_STOP_PROVISIONING = 1u << 1,
  /** Associate using whatever credentials are currently configured. */
  VG_PROV_ACTION_CONNECT_WIFI = 1u << 2,
  /** Arm a one-shot timer for `retry_delay_ms`. */
  VG_PROV_ACTION_ARM_RETRY_TIMER = 1u << 3,
  /** The credentials just proved themselves; they may be kept. */
  VG_PROV_ACTION_COMMIT_CREDENTIALS = 1u << 4,
  /**
   * Throw away credentials that never worked and let the phone try again.
   * Distinct from erasing: nothing that ever worked is being discarded.
   */
  VG_PROV_ACTION_DISCARD_CREDENTIALS = 1u << 5,
  /** Erase stored credentials. Paired with a reboot. */
  VG_PROV_ACTION_ERASE_CREDENTIALS = 1u << 6,
  /**
   * Restart the device.
   *
   * Re-entering provisioning is a reboot rather than a restart of the BLE
   * stack because the successful path releases the Bluetooth controller's
   * memory to the heap, and that memory cannot be reclaimed while the device
   * is running. Rebooting into a known state is both simpler and more
   * reliable than keeping the radio alive for a case that is rare.
   */
  VG_PROV_ACTION_REBOOT = 1u << 7,
  /** The network is usable. Seam for the VG-006 cloud session client. */
  VG_PROV_ACTION_SESSION_UP = 1u << 8,
  /** The network is gone; tear down anything that depended on it. */
  VG_PROV_ACTION_SESSION_DOWN = 1u << 9,
} vg_prov_action_t;

typedef struct {
  /** Bitwise OR of vg_prov_action_t. */
  uint32_t actions;
  /** Meaningful only with VG_PROV_ACTION_ARM_RETRY_TIMER. */
  uint32_t retry_delay_ms;
  /** Set when this transition was caused by a failure, for logging. */
  bool has_failure;
  vg_prov_fail_reason_t failure;
} vg_prov_outcome_t;

typedef struct {
  vg_prov_state_t state;
  /** Credentials that have connected at least once are stored. */
  bool has_credentials;
  /** The current connection attempt belongs to a provisioning session. */
  bool in_provisioning_session;
  /** Consecutive authentication failures against stored credentials. */
  uint32_t auth_failures;
  /** Delay for the next VG_PROV_ACTION_ARM_RETRY_TIMER. */
  uint32_t backoff_ms;
} vg_prov_ctx_t;

/** Puts a context into its pre-boot state. Must be called before use. */
void vg_prov_init(vg_prov_ctx_t *ctx);

/**
 * Applies an event and returns what the caller must do.
 *
 * An event that means nothing in the current state leaves the context
 * untouched and returns no actions, rather than failing: device event
 * sources are asynchronous, and a disconnect notification arriving after a
 * factory reset has already been decided is normal, not a bug.
 */
vg_prov_outcome_t vg_prov_handle(vg_prov_ctx_t *ctx, const vg_prov_event_t *event);

/** Stable name for logs. Never NULL. */
const char *vg_prov_state_name(vg_prov_state_t state);

/** Stable name for logs. Never NULL. */
const char *vg_prov_fail_reason_name(vg_prov_fail_reason_t reason);

#ifdef __cplusplus
}
#endif

#endif /* VG_PROVISIONING_H */
