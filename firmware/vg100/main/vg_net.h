/*
 * ESP-IDF side of provisioning and Wi-Fi (VG-007).
 *
 * This file owns the radios and the ESP-IDF provisioning manager; it owns no
 * policy. Every decision about what to do next comes from `vg_provisioning`,
 * which is pure C and tested on a host compiler. The split is what makes the
 * interesting behaviour -- when credentials are kept, how long to back off,
 * when to reopen provisioning -- testable at all.
 */
#ifndef VG_NET_H
#define VG_NET_H

#include "esp_err.h"
#include "vg_factory.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Brings up networking and enters either provisioning or reconnection,
 * depending on whether credentials are already stored.
 *
 * `identity` is copied. Returns once the decision has been made; everything
 * afterwards is driven by events on the default event loop.
 */
esp_err_t vg_net_start(const vg_factory_identity_t *identity);

/**
 * Asks for a factory reset from outside the event loop.
 *
 * Posts to the default event loop rather than acting, so that the state
 * machine is only ever touched from one task and needs no lock of its own.
 */
esp_err_t vg_net_request_factory_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* VG_NET_H */
