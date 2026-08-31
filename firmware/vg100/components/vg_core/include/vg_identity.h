/*
 * Device identity for the VG-100 gateway (VG-007).
 *
 * The serial number is the one thing that ties a physical box to a row in
 * the cloud database, a label on the carton, and the entry the customer taps
 * in the app. These helpers are pure so the rules about it can be tested on
 * a host compiler; reading the value out of the factory partition is
 * `main/vg_factory.c`.
 */
#ifndef VG_IDENTITY_H
#define VG_IDENTITY_H

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Serial number bounds, matching the pattern VG-005 enforces at
 * registration (`^[A-Za-z0-9-]{4,64}$`).
 *
 * Duplicated here rather than shared because nothing can be shared across a
 * C firmware and a TypeScript service. The cost of the duplication is a test
 * on each side asserting the same boundaries, which is cheaper than a device
 * that flashes successfully and is then refused by the cloud forever.
 */
#define VG_IDENTITY_SERIAL_MIN_LENGTH 4u
#define VG_IDENTITY_SERIAL_MAX_LENGTH 64u

/**
 * BLE advertising budget for the device name.
 *
 * `wifi_prov_scheme_ble` puts the name in the scan response alongside a
 * 128-bit service UUID, and the ESP-IDF documentation gives 11 bytes as the
 * default name allowance. Exceeding it does not fail loudly -- the name is
 * truncated in the air, and the app scans for something that is not there.
 */
#define VG_IDENTITY_SERVICE_NAME_MAX_LENGTH 11u
#define VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE (VG_IDENTITY_SERVICE_NAME_MAX_LENGTH + 1u)

/** Product prefix, so a scanning app can filter before connecting. */
#define VG_IDENTITY_SERVICE_NAME_PREFIX "VG100-"

/** How much of the serial number the advertised name carries. */
#define VG_IDENTITY_SERVICE_NAME_SUFFIX_LENGTH 5u

/**
 * Firmware version bound, matching `MAX_FIRMWARE_VERSION_LENGTH` in the
 * VG-006 session protocol. A version this device would report but the cloud
 * would reject is a defect worth catching here.
 */
#define VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH 64u

/** Large enough for any `vg_identity_describe` output, including the NUL. */
#define VG_IDENTITY_DESCRIBE_BUFFER_SIZE 192u

/** True when the cloud would accept this serial number (VG-005). */
bool vg_identity_serial_is_valid(const char *serial);

/**
 * True when a firmware version string is safe to report and short enough for
 * the cloud to accept: printable ASCII, with no quote or backslash that
 * would have to be escaped in the identity response.
 */
bool vg_identity_firmware_version_is_valid(const char *firmware_version);

/**
 * Derives the advertised BLE name from the serial number.
 *
 * The suffix is the tail of the serial rather than the head, because
 * manufacturing serials share their leading characters and differ in their
 * trailing ones. It is a display aid, not an identifier: a truncated tail
 * can collide, so an app that must be sure which gateway it is talking to
 * reads the full serial from `vg_identity_describe` after connecting.
 *
 * `out_size` must be at least VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE. Returns
 * false, leaving `out` untouched, for an invalid serial or a short buffer.
 */
bool vg_identity_service_name(char *out, size_t out_size, const char *serial);

/**
 * Writes the JSON body of the `vg-identity` provisioning endpoint:
 *
 *   {"serial_number":"VG100-000123","firmware_version":"0.1.0"}
 *
 * The app calls this over the encrypted provisioning session, before it
 * sends Wi-Fi credentials, to confirm it is provisioning the gateway the
 * user scanned rather than a neighbour's.
 *
 * Returns the number of bytes written excluding the terminating NUL, or -1
 * if an argument is invalid or the buffer is too small. Both inputs are
 * validated rather than escaped: the character sets they are restricted to
 * contain nothing JSON would need escaping for, so anything else is a bug
 * upstream and is refused instead of being papered over.
 */
int vg_identity_describe(char *out, size_t out_size, const char *serial,
                         const char *firmware_version);

#ifdef __cplusplus
}
#endif

#endif /* VG_IDENTITY_H */
