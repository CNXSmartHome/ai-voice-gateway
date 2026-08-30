# MVP API Contract

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
