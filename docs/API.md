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
Gateway endpoint concept:
`wss://api.example.com/v1/gateway/session`

Session must bind authenticated gateway_id and room_id before AI tool execution.
