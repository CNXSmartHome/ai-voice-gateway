# VG-100 Gateway Firmware (VG-007)

ESP32-S3 / ESP-IDF firmware for the VG-100 voice gateway.

**Status:** reserved. Not yet initialized. ESP-IDF builds with CMake and its
own toolchain, so this directory stays outside the npm workspace.

## Planned scope
| Task | Description |
| --- | --- |
| VG-007 | BLE Wi-Fi provisioning skeleton |
| VG-018 | Audio capture and streaming |
| VG-027 | Voice response playback |
| VG-028 | Device credentials |
| VG-030 / VG-031 | OTA update and rollback |

## Architecture constraints
These hold for every firmware task (`docs/ARCHITECTURE.md`):

- The gateway holds **no** smart-home device database.
- Tuya credentials **never** reach the gateway.
- The gateway is an authenticated audio/transport endpoint; all device
  resolution and control authorization happen in the cloud.
