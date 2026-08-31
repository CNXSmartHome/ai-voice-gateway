/*
 * Factory-written device identity (VG-007).
 *
 * Two values are burned into a read-only NVS partition at manufacture and
 * never written again by the firmware:
 *
 *   serial    the number printed on the label and registered in the cloud
 *             by `apps/api/scripts/register-gateway.js` (VG-005)
 *   prov_pop  the proof of possession for the BLE provisioning session,
 *             printed on the label so the owner can type or scan it
 *
 * The partition is separate from the application NVS so that erasing
 * credentials -- which a factory reset does -- cannot take a device's
 * identity with it. Neither value is in this repository, and the proof of
 * possession is never logged.
 *
 * The VG-006 device secret is deliberately not here. It is the credential
 * the gateway authenticates to the cloud with, and it has no business being
 * readable by a phone standing next to the device.
 */
#ifndef VG_FACTORY_H
#define VG_FACTORY_H

#include "esp_err.h"
#include "vg_identity.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VG_FACTORY_PARTITION_LABEL "vg_factory"
#define VG_FACTORY_NAMESPACE "vg_device"
#define VG_FACTORY_KEY_SERIAL "serial"
#define VG_FACTORY_KEY_POP "prov_pop"

/**
 * Proof-of-possession bounds.
 *
 * The minimum is a manufacturing contract, not a guess: the PoP is the only
 * thing standing between a stranger in BLE range and this device's Wi-Fi
 * session, so a short one is refused rather than accepted with a warning.
 */
#define VG_FACTORY_POP_MIN_LENGTH 16u
#define VG_FACTORY_POP_MAX_LENGTH 64u

typedef struct {
  char serial_number[VG_IDENTITY_SERIAL_MAX_LENGTH + 1u];
  char provisioning_pop[VG_FACTORY_POP_MAX_LENGTH + 1u];
} vg_factory_identity_t;

/**
 * Reads and validates the factory identity.
 *
 * Returns ESP_ERR_INVALID_STATE when the partition is missing or unreadable,
 * ESP_ERR_NVS_NOT_FOUND when a value was never written, and
 * ESP_ERR_INVALID_SIZE or ESP_ERR_INVALID_ARG when a value is present but
 * outside its bounds. Every one of those is a device that left the line
 * incorrectly, and the caller should refuse to run rather than improvise.
 */
esp_err_t vg_factory_load(vg_factory_identity_t *out);

#ifdef __cplusplus
}
#endif

#endif /* VG_FACTORY_H */
