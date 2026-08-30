# Universal Device Model

## Hierarchy
Organization -> Property -> Room -> Gateway / Device

## Device record
```json
{
  "id": "dev_10021",
  "name": "Bedroom AC",
  "room_id": "room_master",
  "type": "climate",
  "platform": "tuya",
  "external_id": "provider-device-id",
  "capabilities": ["power", "target_temperature", "hvac_mode", "fan_speed"]
}
```

## MVP device types
- light
- climate
- curtain
- switch
- scene

## Canonical capabilities
### Common
- power

### Light
- brightness
- color_temperature
- rgb

### Climate
- target_temperature
- current_temperature
- hvac_mode
- fan_speed

### Curtain
- position
- open
- close
- stop

### Scene
- execute

## Rule
Provider-specific capability names must be normalized in the adapter layer before reaching AI tools.
