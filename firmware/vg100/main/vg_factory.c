#include "vg_factory.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "vg_factory";

/**
 * Reads one string value into a fixed buffer.
 *
 * `nvs_get_str` reports the required size through the same argument it takes
 * the available size in, so a value longer than the buffer comes back as
 * ESP_ERR_NVS_INVALID_LENGTH rather than being truncated.
 */
static esp_err_t read_string(nvs_handle_t handle, const char *key, char *out, size_t out_size) {
  size_t length = out_size;
  return nvs_get_str(handle, key, out, &length);
}

esp_err_t vg_factory_load(vg_factory_identity_t *out) {
  if (out == NULL) {
    return ESP_ERR_INVALID_ARG;
  }
  memset(out, 0, sizeof(*out));

  /* Initialised, never erased. A corrupt factory partition is a device that
   * cannot prove who it is, and erasing it would destroy the only copy of
   * the identity rather than fix anything. */
  esp_err_t err = nvs_flash_init_partition(VG_FACTORY_PARTITION_LABEL);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "factory partition '%s' unavailable: %s", VG_FACTORY_PARTITION_LABEL,
             esp_err_to_name(err));
    return ESP_ERR_INVALID_STATE;
  }

  nvs_handle_t handle;
  err = nvs_open_from_partition(VG_FACTORY_PARTITION_LABEL, VG_FACTORY_NAMESPACE, NVS_READONLY,
                                &handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "factory namespace '%s' unavailable: %s", VG_FACTORY_NAMESPACE,
             esp_err_to_name(err));
    return ESP_ERR_INVALID_STATE;
  }

  err = read_string(handle, VG_FACTORY_KEY_SERIAL, out->serial_number, sizeof(out->serial_number));
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "serial number unreadable: %s", esp_err_to_name(err));
    goto done;
  }

  err = read_string(handle, VG_FACTORY_KEY_POP, out->provisioning_pop,
                    sizeof(out->provisioning_pop));
  if (err != ESP_OK) {
    /* Deliberately says nothing about the value, only that it is unusable. */
    ESP_LOGE(TAG, "proof of possession unreadable: %s", esp_err_to_name(err));
    goto done;
  }

  if (!vg_identity_serial_is_valid(out->serial_number)) {
    /* Caught here rather than at the first cloud connection: a serial the
     * cloud will refuse is a manufacturing defect, and it should be visible
     * on the production line, not at a customer's house. */
    ESP_LOGE(TAG, "serial number does not match the registration pattern");
    err = ESP_ERR_INVALID_ARG;
    goto done;
  }

  size_t pop_length = strlen(out->provisioning_pop);
  if (pop_length < VG_FACTORY_POP_MIN_LENGTH || pop_length > VG_FACTORY_POP_MAX_LENGTH) {
    ESP_LOGE(TAG, "proof of possession is %u characters; %u to %u required",
             (unsigned)pop_length, (unsigned)VG_FACTORY_POP_MIN_LENGTH,
             (unsigned)VG_FACTORY_POP_MAX_LENGTH);
    err = ESP_ERR_INVALID_SIZE;
    goto done;
  }

  ESP_LOGI(TAG, "identity loaded for %s", out->serial_number);

done:
  nvs_close(handle);
  if (err != ESP_OK) {
    /* Nothing partially read is left where a caller might use it. */
    memset(out, 0, sizeof(*out));
  }
  return err;
}
