# VG-100 Gateway Firmware

ESP32-S3 / ESP-IDF firmware for the VG-100 voice gateway.

Built and tested against **ESP-IDF v5.5**. This directory is outside the npm
workspace: ESP-IDF builds with CMake and its own toolchain, and nothing here
is reachable from `npm run build`.

## What it does today (VG-007)

A factory-fresh gateway has no Wi-Fi credentials, so it cannot be told them
over Wi-Fi. The phone hands them over BLE instead, and this firmware is the
device end of that exchange:

1. Read the serial number and the proof of possession from the read-only
   factory partition. If either is missing or malformed, stop — do not
   advertise, do not fall back to an unauthenticated session.
2. With no stored credentials, advertise as `VG100-XXXXX` and accept a
   provisioning session protected by the proof of possession.
3. With stored credentials, connect, and keep reconnecting for as long as it
   takes.

Everything after "connected" — the cloud session (VG-006), audio (VG-018),
OTA (VG-030) — is a later task. `vg_net.c` marks the two places the session
client attaches.

## Layout

```
CMakeLists.txt              ESP-IDF project; PROJECT_VER is the reported version
partitions.csv              Fixed layout, including the reserved OTA slots
sdkconfig.defaults          Target, flash size, NimBLE
factory_nvs.csv.example     Template for the per-device factory partition
components/vg_core/         Pure C: provisioning policy and identity rules
main/                       ESP-IDF glue: NVS, Wi-Fi, BLE provisioning, reset control
test/host/                  Host build of components/vg_core, run by CI
```

### Why the policy is a separate component

`components/vg_core` has no ESP-IDF dependency at all. It decides when to
advertise, whether a set of credentials has earned the right to be kept, how
long to wait before the next attempt, and when to give up and start over —
and it does that as a function from a state and an event to a list of
actions. `main/vg_net.c` performs those actions and has no opinions.

The reason is testability. Testing this on hardware means a board, a router,
and a person to unplug it; testing it as pure C means `ctest`. Both the host
test build and the ESP-IDF build compile the same sources, so the tested code
is the shipped code.

## Provisioning behaviour

| Situation | What happens |
| --- | --- |
| No stored credentials | Advertise over BLE and wait |
| Credentials that connect | Keep them, close the BLE service |
| Credentials that fail | Discard them, tell the phone, keep advertising |
| Working network drops | Reconnect: 1s, 2s, 4s … capped at 60s, indefinitely |
| Five authentication failures in a row | Erase and reboot into provisioning |
| Reset control held | Erase and reboot into provisioning |

Two of these are worth their own sentence.

**Credentials are not kept until they work.** A mistyped password that got
stored would leave the device provisioned as far as the firmware is
concerned, retrying something that can never succeed, recoverable only with
the reset button. Discarding it instead means the phone can simply send the
right one.

**A changed router password is recoverable from the app.** Five consecutive
authentication failures — not a router that is switched off, which reports
something else and is retried forever — erase the stored credentials and
reboot into provisioning. Without that, a gateway mounted in a ceiling needs
a ladder.

Re-entering provisioning is a reboot rather than a restart of the BLE stack
because the successful path hands the Bluetooth controller's memory back to
the heap, and it cannot be reclaimed while the device is running.

## Security

- Provisioning uses **Security1**: an X25519 handshake and AES-CTR, keyed by
  a per-device proof of possession. The Wi-Fi password does not cross the air
  in clear text.
- The proof of possession is generated per device at manufacture, written to
  the `vg_factory` partition, and printed on the label. It is not in this
  repository, not derived from the serial number, and never logged.
- Without a usable proof of possession the device does not provision at all.
  There is no unauthenticated fallback.
- The VG-006 device secret — the credential the gateway authenticates to the
  cloud with — is deliberately not readable over the provisioning session.
- Provisioning stops once the device is connected, so the BLE surface is not
  left open for the life of the device.

**Known limitation.** Security1 keeps the proof of possession as plaintext on
flash, so someone with physical access and a flash reader can provision the
device onto their own network. The mitigations are flash encryption and
Security2 (SRP6a), which stores a verifier rather than the secret itself.
Flash encryption is a bootloader change, and `AI_GOVERNANCE.md` puts those
behind Product Owner approval; both belong with VG-028.

## Partition table

```
nvs          data nvs   0x9000   0x6000    Wi-Fi credentials; erased by a factory reset
otadata      data ota   0xf000   0x2000
phy_init     data phy   0x11000  0x1000
vg_factory   data nvs   0x12000  0x4000    Serial number and proof of possession
ota_0        app  ota_0 0x20000  0x300000
ota_1        app  ota_1 0x320000 0x300000
```

The OTA slots are reserved even though nothing writes to them until VG-030.
Changing a partition table after devices ship means reflashing them over a
wire, so the layout is settled once, now.

`vg_factory` is separate from `nvs` for the same reason: a factory reset
erases credentials, and it must not be able to take the device's identity
with it.

## Manufacturing

Each device needs a row in the cloud and a matching factory partition.

```bash
# 1. Register the serial and issue the VG-006 device secret. Printed once.
node apps/api/scripts/register-gateway.js VG100-000123

# 2. Generate a proof of possession for the provisioning session.
openssl rand -hex 16

# 3. Fill in a copy of the template and build the partition image.
cp firmware/vg100/factory_nvs.csv.example /tmp/factory_nvs.csv
$EDITOR /tmp/factory_nvs.csv
python "$IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py" \
    generate /tmp/factory_nvs.csv /tmp/factory_nvs.bin 0x4000

# 4. Flash the application and the factory partition.
idf.py -C firmware/vg100 flash
esptool.py write_flash 0x12000 /tmp/factory_nvs.bin
```

The serial number, the device secret, and the proof of possession all go on
the label. The filled-in CSV is secret-bearing and belongs in whatever the
line uses for key material — CI fails if one is ever committed.

## Building

```bash
idf.py -C firmware/vg100 set-target esp32s3
idf.py -C firmware/vg100 build
idf.py -C firmware/vg100 -p PORT flash monitor
```

## Host tests

No ESP-IDF, no hardware; any C compiler and CMake:

```bash
cmake -S firmware/vg100/test/host -B build/firmware-host
cmake --build build/firmware-host
ctest --test-dir build/firmware-host --output-on-failure
```

CI runs exactly these three commands, plus the ESP-IDF build — see
[`docs/CI.md`](../../docs/CI.md).

## Planned scope

| Task | Description |
| --- | --- |
| VG-007 | BLE Wi-Fi provisioning skeleton — **done** |
| VG-018 | Audio capture and streaming |
| VG-027 | Voice response playback |
| VG-028 | Device credentials, flash encryption, secure boot |
| VG-030 / VG-031 | OTA update and rollback |

## Architecture constraints

These hold for every firmware task ([`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)):

- The gateway holds **no** smart-home device database.
- Tuya credentials **never** reach the gateway.
- The gateway is an authenticated audio/transport endpoint; all device
  resolution and control authorization happen in the cloud.
