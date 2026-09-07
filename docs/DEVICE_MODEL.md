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

## Resources
A **resource** is anything the control pipeline will act on (VG-040). It is
registered against a property and, optionally, a room, and it is addressed by
the canonical vocabulary above — never by a provider identifier.

Resource kinds are exactly the MVP device types. A resource generalizes
*ownership, resolution, and control*; it does not introduce a second
vocabulary, so there is one place to add a new kind and no mapping between two
lists that could drift.

```json
{
  "id": "res_10021",
  "property_id": "prop_villa_one",
  "room_id": "room_master",
  "name": "Bedroom AC",
  "kind": "climate",
  "capabilities": ["power", "target_temperature"],
  "enabled": true
}
```

A `Device` records what an adapter imported. A `Resource` records what the
system is willing to act on and who may act on it. The two are separate
because they answer different questions, and because the pipeline must be able
to refuse — a disabled resource, a resource in another property — without that
refusal depending on what a provider currently reports.

### Provider binding
Where a resource actually lives — its platform and that platform's own
identifier — is held in a separate `ResourceBinding` record. It is never part
of a resource view. Nothing above the adapter boundary is told which platform
a resource is on, because a caller that can branch on the platform has already
lost provider independence.

### Smart Villa terminology
Smart Villa names map onto this hierarchy. They add no tables:

- **Villa** = Property
- **Zone** = Room

## Rule
Provider-specific capability names must be normalized in the adapter layer before reaching AI tools.

Provider-specific *identifiers* must not cross the adapter boundary at all.
