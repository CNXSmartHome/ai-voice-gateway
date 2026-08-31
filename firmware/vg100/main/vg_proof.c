#include "vg_proof.h"

#include "esp_log.h"
#include "nvs.h"

static const char *TAG = "vg_proof";

/** Written as a byte rather than a bare key, so the value is explicit. */
static const uint8_t PROVEN = 1;

esp_err_t vg_proof_read(bool *proven) {
  if (proven == NULL) {
    return ESP_ERR_INVALID_ARG;
  }
  *proven = false;

  nvs_handle_t handle;
  esp_err_t err = nvs_open(VG_PROOF_NAMESPACE, NVS_READONLY, &handle);
  if (err == ESP_ERR_NVS_NOT_FOUND) {
    // The namespace has never been written. Nothing has been proven.
    return ESP_OK;
  }
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "could not read the proof marker: %s", esp_err_to_name(err));
    return err;
  }

  uint8_t value = 0;
  err = nvs_get_u8(handle, VG_PROOF_KEY, &value);
  nvs_close(handle);

  if (err == ESP_ERR_NVS_NOT_FOUND) {
    return ESP_OK;
  }
  if (err != ESP_OK) {
    return err;
  }

  *proven = value == PROVEN;
  return ESP_OK;
}

static esp_err_t write_marker(bool proven) {
  nvs_handle_t handle;
  esp_err_t err = nvs_open(VG_PROOF_NAMESPACE, NVS_READWRITE, &handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "could not open the proof marker: %s", esp_err_to_name(err));
    return err;
  }

  err = proven ? nvs_set_u8(handle, VG_PROOF_KEY, PROVEN) : nvs_erase_key(handle, VG_PROOF_KEY);
  if (err == ESP_ERR_NVS_NOT_FOUND && !proven) {
    // Already absent, which is what clearing it means.
    err = ESP_OK;
  }

  if (err == ESP_OK) {
    // Committed before returning: the caller's next step assumes this
    // survives a power loss, and an uncommitted write does not.
    err = nvs_commit(handle);
  }

  nvs_close(handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "could not write the proof marker: %s", esp_err_to_name(err));
  }
  return err;
}

esp_err_t vg_proof_set(void) {
  return write_marker(true);
}

esp_err_t vg_proof_clear(void) {
  return write_marker(false);
}
