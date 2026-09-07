# Smart Villa Gateway

The existing AI Voice Gateway backend is the foundation for Smart Villa Gateway.
This is an additive product extension, not a second backend.

## Boundary

Smart Villa Gateway is authoritative for tenant context, hospitality workflows,
resource resolution, authorization and provider dispatch. Clients never receive
provider credentials or provider-specific identifiers.

```text
SVC-Voice / Guest QR / Staff UI
              |
              v
      Smart Villa Gateway
              |
      +-------+-------+
      |               |
 control/workflow   events
      |
 resource resolver
      |
 adapter registry
      |
 HA / SVC-100 / MQTT / future providers
```

## Existing model mapping

The repository already models `Organization -> Property -> Room`. For Smart Villa:

- `Property` is the villa/site boundary.
- `Room` is the zone/room boundary.
- `Gateway` covers VG-100 and future SVC-Voice-class voice terminals.
- `Device` remains a provider-normalized controllable endpoint.

Do not introduce duplicate `Villa` or `Zone` tables merely to rename these concepts.
Public API aliases can use villa/zone terminology later without duplicating ownership data.

## Service requests (VG-039)

`ServiceRequest` is the common workflow record for guest web, voice, staff and
automation sources. PostgreSQL is authoritative. Every state change appends an
immutable `ServiceRequestEvent` in the same database transaction.

Allowed state transitions:

```text
NEW -> ACKNOWLEDGED -> IN_PROGRESS -> COMPLETED
 |          |               |
 +-> CANCELLED <------------+
 +-> REJECTED <- ACKNOWLEDGED
```

The authenticated operator API is intentionally the first entry point. Guest QR
and SVC-Voice APIs will call the same `ServiceRequestsService` in later tasks.

Mutation retries use the `Idempotency-Key` header. The key is scoped by property,
so a retry cannot create duplicate hospitality tickets within one villa.

## Next slices

- VG-040: resource registry + ControlService -> Policy -> Resolver -> Adapter
- VG-041: SVC-Voice semantic device API
- VG-042: Guest QR session + villa information API
- VG-043: staff realtime workflow events

## Security rules

- Tenant identity is derived from authenticated membership/device/session context.
- A request body cannot grant access to another property.
- Provider credentials and external IDs remain server-side.
- Door, gate and alarm authorization policy remains out of scope until explicit
  Product Owner approval as required by `AI_GOVERNANCE.md`.
