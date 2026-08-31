# MVP API Contract

## Authentication

Every endpoint below requires a bearer token unless it is listed as public.

- POST `/v1/auth/register` — public
- POST `/v1/auth/login` — public
- GET `/v1/auth/me`
- GET `/v1/health`, GET `/v1/health/ready` — public

Register creates an organization, its first user, and an owner membership in
one step; there is no separate organization endpoint in the MVP.

```json
POST /v1/auth/register
{
  "email": "owner@example.com",
  "password": "at least 12 characters",
  "name": "Owner",
  "organizationName": "Example Villas"
}
```

Register and login both return:

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "user": {
    "id": "user_1",
    "email": "owner@example.com",
    "name": "Owner",
    "memberships": [{ "organizationId": "org_1", "role": "OWNER" }]
  }
}
```

Protected routes take the token in the standard header:

```
Authorization: Bearer <accessToken>
```

Every authentication failure — absent, malformed, expired, wrongly signed, or
belonging to a disabled account — is a `401` with no explanation of which.
Login answers a wrong password and an unknown address identically.

Tokens are short-lived and there is no refresh endpoint yet: when one expires
the client authenticates again. Roles are recorded on the membership but are
not yet enforced as permissions.

## Properties

A property is a place the system covers — a villa, a house, a floor. It owns
rooms, gateways, and devices, and it is what `POST /v1/gateways/claim` binds
hardware to.

- POST `/v1/properties` — implemented
- GET `/v1/properties` — implemented
- GET `/v1/properties/{id}` — implemented
- PATCH `/v1/properties/{id}` — implemented

```json
POST /v1/properties
{
  "organizationId": "org_1",
  "name": "Villa One"
}
```

`organizationId` is required: a caller can be a member of more than one
organization, and the API does not guess.

Returns `201`:

```json
{
  "id": "prop_1",
  "organizationId": "org_1",
  "name": "Villa One",
  "timezone": "UTC",
  "createdAt": "2026-08-31T00:00:00.000Z",
  "updatedAt": "2026-08-31T00:00:00.000Z"
}
```

`timezone` is reported but not settable. The column has existed since VG-003
and defaults to `UTC`; giving it an owner is its own task, because everything
time-shaped that will depend on it — schedules, an evening scene — arrives
later.

`GET /v1/properties` returns the properties of every organization the caller
belongs to, scoped from their memberships rather than from any parameter.

`PATCH` renames, and only renames. It does not accept `organizationId`, and
the validation pipe rejects it as an unknown field: moving a property would
carry its rooms, gateways, and devices across an authorization boundary, and
that is not a rename.

**Failure semantics.** `400` for a malformed body, an unknown field, or a
`PATCH` with no `name`. `401` for an unauthenticated caller. `409` for a name
already used in the same organization — the caller can list their own
properties, so there is nothing to hide and "that name is taken" is what they
need to know.

Then two codes that are deliberately different from each other:

| Situation | Code |
| --- | --- |
| The property does not exist | `404` |
| The property belongs to an organization the caller is not in | `404` |
| The caller is a `MEMBER` of the owning organization | `403` |

The first two are indistinguishable on purpose: a caller outside an
organization has no way to know its properties exist, and this endpoint must
not become the way. The third is different because that caller already knows
— `GET` returns the property to them — so a `404` would only mislead.
`MEMBER` is the role for residents and guests, who live in a property rather
than define it.

This is a finer distinction than `POST /v1/gateways/claim` draws, which
answers every rejection identically. That endpoint's caller has no read
access to properties at all, so it cannot make the distinction without
leaking; here the caller's read access already settles it.

A `PATCH` is authorized against the property's organization and then carries
that organization into the write itself, so a property moved to another
organization in between is refused with the same `404` rather than modified
under an authorization that no longer applies.

## Gateway
- POST `/v1/gateways/claim` — implemented (VG-005)
- GET `/v1/gateways`
- GET `/v1/gateways/{id}`
- PATCH `/v1/gateways/{id}`
- POST `/v1/gateways/{id}/ota`

### POST `/v1/gateways/claim`

Binds a manufactured gateway to a property. A gateway exists from manufacture
as `UNCLAIMED` with no property; the claim updates that existing row, so the
gateway keeps its `id`, `serial_number`, and creation time.

Requires an `OWNER` or `ADMIN` membership of the organization that owns the
target property. A `MEMBER` cannot claim: attaching hardware is an
administrative action, while `MEMBER` is the role for residents and guests.

```json
POST /v1/gateways/claim
{
  "serialNumber": "VG100-0001",
  "propertyId": "prop_1",
  "roomId": "room_1",
  "name": "Hall gateway"
}
```

`roomId` and `name` are optional. A supplied room must belong to the target
property. `name` defaults to whatever the gateway was registered with.

Returns `200` — not `201`, because the gateway already existed:

```json
{
  "id": "gw_1",
  "serialNumber": "VG100-0001",
  "name": "Hall gateway",
  "status": "OFFLINE",
  "propertyId": "prop_1",
  "roomId": "room_1",
  "firmwareVersion": null,
  "lastSeenAt": null,
  "createdAt": "2026-08-30T00:00:00.000Z",
  "updatedAt": "2026-08-30T10:00:00.000Z"
}
```

The claimed gateway is `OFFLINE`, not `ONLINE`: the claim records ownership,
it does not mean the hardware has connected. The heartbeat (VG-006) is what
brings it online.

**Failure semantics.** `400` for a malformed body and `401` for an
unauthenticated caller. Everything else is the same `404`:

- the serial number is not registered
- the gateway is already claimed
- the property does not exist
- the property belongs to another organization
- the caller lacks an `OWNER`/`ADMIN` membership of that organization
- the supplied room is not in that property

These are deliberately indistinguishable. Separating them would let anyone
enumerate which serial numbers exist and which are already in service, and do
the same for property identifiers. A rejected claim writes nothing: the
gateway stays `UNCLAIMED` and claimable.

Concurrent claims of one gateway resolve to exactly one winner; the losers
receive the same `404`.

### Registering a gateway for manufacture

Creating `UNCLAIMED` gateways is manufacturing intake, not a customer action,
so it is not exposed over HTTP — that would need an operator role the API
does not have. Use the script, which requires database credentials:

```
npm run gateway:register --workspace @vg/api -- VG100-0001 "VG-100"
```

### Provisioning a gateway onto Wi-Fi (BLE, VG-007)

This one is not an HTTP endpoint and never can be: a factory-fresh gateway
has no network, so the phone reaches it over BLE. It is documented here
because the mobile app (VG-008) is the other end of it.

The device runs the ESP-IDF `wifi_provisioning` protocol with the BLE scheme
and **Security1**, so the app can use the standard `ESPProvision` libraries
rather than a bespoke GATT client.

| | |
| --- | --- |
| Advertised name | `VG100-` plus the last five characters of the serial number |
| Security | Security1, X25519 + AES-CTR |
| Proof of possession | Per device, printed on the label; the user scans or types it |
| Standard endpoints | `prov-session`, `prov-config`, `prov-scan` |
| Extra endpoint | `vg-identity` |

`vg-identity` answers with the full serial number, because the advertised
name carries only a truncated one:

```json
{ "serial_number": "VG100-000123", "firmware_version": "0.1.0" }
```

The app should read it after the session is established and before sending
credentials, so it can confirm it is provisioning the gateway the user
scanned rather than a neighbour's. The same serial is what
`POST /v1/gateways/claim` takes.

Credentials that fail to authenticate are reported to the app and **not**
kept by the device, so a mistyped password can simply be sent again in the
same session. Full behaviour is in
[`../firmware/vg100/README.md`](../firmware/vg100/README.md).

## Rooms
- GET `/v1/properties/{property_id}/rooms`
- POST `/v1/properties/{property_id}/rooms`
- PATCH `/v1/rooms/{id}`

## Integrations
- GET `/v1/integrations`
- POST `/v1/integrations/tuya/connect`
- POST `/v1/integrations/{id}/sync`
- DELETE `/v1/integrations/{id}`

## Devices
- GET `/v1/devices`
- GET `/v1/devices/{id}/state`
- POST `/v1/devices/{id}/command`
- PATCH `/v1/devices/{id}`

Example command:
```json
{
  "capability": "power",
  "value": true
}
```

## AI tools
- `get_room_context()`
- `list_devices(room_id?, type?)`
- `get_device_state(device_id)`
- `control_device(device_id, capability, value)`
- `control_room(room_id, selector, action)`
- `activate_scene(scene_id)`

## WebSocket

Gateway session endpoint — implemented (VG-006):

`wss://api.example.com/v1/gateway/session`

Session must bind authenticated gateway_id and room_id before AI tool execution.

### Device authentication

A gateway authenticates with its serial number and the device secret issued at
manufacture, on the upgrade request:

```
Authorization: Gateway <serialNumber>:<secret>
```

Its own scheme, not `Bearer`, so a device credential and a user access token
can never be presented interchangeably. A user token does not parse here, and
a device secret is meaningless to the HTTP API.

Authentication happens **during the HTTP upgrade**. A device that fails it
never becomes a WebSocket: the handshake is refused with `401`, rather than
being accepted and then closed. An unknown serial number, a wrong secret, an
unclaimed gateway, and a disabled one are all refused identically — separating
them would let anyone enumerate which serial numbers exist and which are in
service.

Only a **claimed, non-disabled** gateway may open a session. An unclaimed one
has no property and therefore no room context.

### Messages

The gateway is greeted with its identity and how often to report:

```json
{ "type": "ready", "gatewayId": "gw_1", "roomId": "room_1", "heartbeatIntervalSeconds": 30 }
```

`roomId` is the room the gateway is in **at the moment it comes online**, not
the one it was in when the request arrived. The room is the voice context —
it is what turns "turn on the light" into a specific device — and a session
lasts as long as the device stays connected, so a room read before the status
transition could send commands to the wrong place for hours. It is read back
inside the same transaction, after the transition, while the row is still
locked. A gateway with no room reports `null`; assigning one is VG-013.

It then sends heartbeats, optionally reporting its firmware version:

```json
{ "type": "heartbeat", "firmwareVersion": "1.2.3" }
```

and receives:

```json
{ "type": "heartbeat_ack", "serverTime": "2026-08-30T12:00:00.000Z" }
```

A heartbeat refreshes `last_seen_at` and records firmware only. It can never
move a gateway between properties or rooms — a device saying it is still there
must not be able to reassign itself.

An unparseable or unknown frame closes the connection with `4400`, rather than
being ignored: both ends are one implementation, so a frame neither
understands means they are out of step. Binary frames are rejected — audio has
its own task (VG-018).

### Status lifecycle

| Event | Status |
| --- | --- |
| Claimed (VG-005) | `OFFLINE` |
| Authenticated connect | `ONLINE` |
| Heartbeat | stays `ONLINE`, `last_seen_at` advances |
| Clean disconnect | `OFFLINE` |
| Stopped answering pings | closed with `4408`, then `OFFLINE` |
| Disabled during a session | closed with `4401`, stays `DISABLED` |

**Disabling a gateway takes effect immediately, and stays in effect.** Both
writes that could undo it are conditional on the state they were decided from:
the connect transition is refused if the gateway is no longer connectable, and
a heartbeat that finds the gateway no longer `ONLINE` closes the session
instead of restoring it. Without those guards, an administrator disabling a
connected gateway would be overwritten by its next heartbeat — within seconds,
and silently, against exactly the device someone is trying to take out of
service. A gateway disabled while connected also stays `DISABLED` when its
socket drops.

The server pings idle connections every `GATEWAY_HEARTBEAT_INTERVAL_SECONDS`.
A device that loses power never sends a close frame, so without this it would
read `ONLINE` indefinitely — worse than useless, since the app would show it
as reachable.

### Issuing a device secret

Done at manufacture, alongside registration. The secret is printed once and
only its hash is stored, so it cannot be recovered:

```
npm run gateway:register --workspace @vg/api -- VG100-0001 "VG-100"
```
