idf_component_register(
  SRCS "main.c" "vg_factory.c" "vg_net.c" "vg_proof.c"
  INCLUDE_DIRS "."
  REQUIRES
    vg_core
    esp_app_format
    esp_driver_gpio
    esp_event
    esp_netif
    esp_timer
    esp_wifi
    nvs_flash
    protocomm
    wifi_provisioning)

# See components/vg_core/CMakeLists.txt.
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror -Wshadow)
