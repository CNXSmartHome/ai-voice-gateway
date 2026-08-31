/*
 * VG-100 gateway firmware entry point (VG-007).
 *
 * Boot order matters here. The device reads who it is before it turns on a
 * radio, and refuses to do anything if that answer is missing: a gateway
 * that cannot prove its identity has no business advertising a provisioning
 * service, and falling back to an unauthenticated one would hand its Wi-Fi
 * to whoever is nearest.
 */
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "vg_factory.h"
#include "vg_net.h"

static const char *TAG = "vg100";

/** How often the reset control is sampled. Long presses do not need better. */
#define VG_RESET_POLL_INTERVAL_MS 100

#define VG_RESET_TASK_STACK_BYTES 2560
#define VG_RESET_TASK_PRIORITY 3

/**
 * Watches the reset control.
 *
 * Active low with the internal pull-up, so the control is a button to
 * ground and an unpopulated pad reads as "not pressed". The pin is a
 * Kconfig option with a development-board default: the VG-100 pinout is not
 * frozen, and freezing it here is not this task's decision to make.
 */
static void reset_button_task(void *arg) {
  (void)arg;

  const gpio_config_t config = {
      .pin_bit_mask = 1ULL << CONFIG_VG_FACTORY_RESET_GPIO,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&config));

  uint32_t held_ms = 0;
  bool requested = false;

  for (;;) {
    if (gpio_get_level(CONFIG_VG_FACTORY_RESET_GPIO) == 0) {
      held_ms += VG_RESET_POLL_INTERVAL_MS;
      /* Requested once per press, not once per poll, so leaning on the
       * button does not queue a reset for every tenth of a second. */
      if (!requested && held_ms >= (uint32_t)CONFIG_VG_FACTORY_RESET_HOLD_MS) {
        requested = true;
        ESP_LOGW(TAG, "reset control held for %dms; erasing credentials",
                 CONFIG_VG_FACTORY_RESET_HOLD_MS);
        ESP_ERROR_CHECK(vg_net_request_factory_reset());
      }
    } else {
      held_ms = 0;
      requested = false;
    }
    vTaskDelay(pdMS_TO_TICKS(VG_RESET_POLL_INTERVAL_MS));
  }
}

/** Initialises application NVS, recovering from a layout or version change. */
static esp_err_t init_nvs(void) {
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    /* Only the application partition. The factory partition holding the
     * device identity is never erased -- see vg_factory.c. */
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  return err;
}

void app_main(void) {
  ESP_ERROR_CHECK(init_nvs());

  vg_factory_identity_t identity;
  esp_err_t err = vg_factory_load(&identity);
  if (err != ESP_OK) {
    /* Deliberately terminal. This device was not finished at manufacture,
     * and every path from here is worse than stopping: see
     * firmware/vg100/README.md for what has to be written and how. */
    ESP_LOGE(TAG, "no usable factory identity (%s); provisioning will not start",
             esp_err_to_name(err));
    return;
  }

  ESP_ERROR_CHECK(vg_net_start(&identity));

  xTaskCreate(reset_button_task, "vg_reset", VG_RESET_TASK_STACK_BYTES, NULL,
              VG_RESET_TASK_PRIORITY, NULL);
}
