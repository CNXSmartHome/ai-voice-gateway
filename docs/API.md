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
- POST `/v1/gateways/claim`
- GET `/v1/gateways`
- GET `/v1/gateways/{id}`
- PATCH `/v1/gateways/{id}`
- POST `/v1/gateways/{id}/ota`

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
