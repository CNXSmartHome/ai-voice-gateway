/*
 * The record that stored Wi-Fi credentials once worked (VG-007).
 *
 * ESP-IDF writes credentials to NVS the moment a phone sends them, before
 * anything tries to use them, and `wifi_prov_mgr_is_provisioned()` reports
 * that as "provisioned". So the Wi-Fi stack cannot tell a working password
 * from one mistyped seconds before the power was pulled — and a device that
 * boots believing the second is the first is stranded, retrying credentials
 * that can never succeed, recoverable only by someone with physical access to
 * the reset control.
 *
 * This is the missing half: a flag the application owns, written only after
 * an address is actually held, cleared whenever credentials are replaced or
 * erased. Credentials without it are the wreckage of an interrupted session,
 * and `vg_provisioning` treats them as such.
 *
 * It lives in the application NVS partition, alongside the credentials it
 * describes, so the two are erased together by a factory reset and by the
 * recovery path in `main.c`. The device identity is in a separate partition
 * and survives both.
 */
#ifndef VG_PROOF_H
#define VG_PROOF_H

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VG_PROOF_NAMESPACE "vg_net"
#define VG_PROOF_KEY "wifi_proven"

/**
 * Reads the marker.
 *
 * A missing key, an unreadable namespace, and an explicit false are all
 * reported as false: every one of them means the credentials on flash have
 * not been shown to work, which is the only question being asked.
 */
esp_err_t vg_proof_read(bool *proven);

/** Records that the stored credentials produced a connection. Durable. */
esp_err_t vg_proof_set(void);

/** Clears the marker. Durable, and safe to call when it is already clear. */
esp_err_t vg_proof_clear(void);

#ifdef __cplusplus
}
#endif

#endif /* VG_PROOF_H */
