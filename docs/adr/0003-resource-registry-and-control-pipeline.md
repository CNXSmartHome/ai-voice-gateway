# ADR 0003: A resource registry and a single control pipeline

- Status: accepted
- Date: 2026-09-07
- Task: VG-040

## Context

`docs/ARCHITECTURE.md` states three non-negotiable boundaries: the AI never
calls Tuya-specific APIs, Tuya credentials never reach the gateway, and the
gateway holds no smart-home device database. It states them; nothing enforced
them. The repository had a `Device` table, a canonical capability vocabulary in
`packages/domain`, and nothing in between — no place where "turn on the ceiling
light" becomes a specific device, is checked against who asked, and is handed
to exactly one adapter.

Week 3 makes that gap urgent. VG-019 gives the AI a realtime session and VG-020
gives it tools. A tool implementation that reaches a provider SDK directly
would satisfy its own acceptance criteria and quietly cost the project its
architecture, because nothing would fail.

The question this ADR answers is where control decisions live and how the
boundary is held.

## Decision

A resource registry and one control pipeline, with the pipeline's ordering
enforced by module encapsulation rather than by convention.

**Resources are separate from devices.** `Device` records what an adapter
imported: a row per provider device, keyed by the provider's identifier.
`Resource` records what the system is willing to act on and who may act on it.
Keeping them apart means the pipeline can refuse — a disabled resource, a
resource in another villa — without that refusal depending on what any provider
currently reports.

**The provider binding lives in its own table.** `ResourceBinding` holds the
platform and the external identifier. `RESOURCE_SELECT` does not select the
relation, so a column added to it later is excluded by default rather than
leaking until someone remembers to filter it. Neither the platform nor the
identifier appears in any view: a caller that can branch on the platform has
already lost provider independence, even if it cannot name the device.

**Resolution is deterministic and never guesses.** A target resolves to exactly
one enabled resource or to one of three reasons — `NOT_FOUND`, `AMBIGUOUS`,
`DISABLED`. Three reasons rather than one because they are three different
things to say to a person: VG-026 turns `AMBIGUOUS` into "the desk lamp or the
ceiling light?", and it cannot do that if the pipeline only reports failure. A
resolver that picked the first of two matching lights would pass every test and
switch on the wrong lamp in someone's villa.

**Policy is a separate service that only refuses.** Every rule in
`PolicyService` denies; none grants. A command is allowed by surviving all of
them, so a rule added later cannot accidentally widen access. Decisions are
`ALLOW`, `DENY`, and `CONFIRMATION_REQUIRED`; the third exists because the
voice tasks need to ask before acting, and folding it into `DENY` would leave
"ask first" inexpressible.

**The ordering is the class.** `ControlService` runs tenancy, then resolution,
then policy, then dispatch. Nothing reaches an adapter that has not passed all
four.

**Encapsulation, not discipline, prevents the bypass.** `ResourcesModule`
exports `ResourceRegistryService` and `ControlService` and nothing else. The
adapter registry, the adapters, the resolver, and the policy service are
providers, so no other module can inject one and dispatch a command that
skipped a step. `test/resources.module.spec.ts` asserts the export list, which
makes widening it a visible edit rather than a convenience taken under
deadline.

## Consequences

Two vocabularies of ownership now exist in the codebase — `Device` and
`Resource` — and until VG-012 populates resources from imported devices, they
are filled in separately. That is a real cost, accepted because merging them
would put provider identifiers back on the object the AI addresses.

`home_assistant` joins the `Platform` enum with a stub adapter behind it. This
is not Home Assistant support. It exists because a registry with one platform
cannot demonstrate provider independence: any Tuya assumption that leaked into
the pipeline would still pass every test, having no second platform to be wrong
about. The real integration is a platform adapter of its own and
DUAL_AI_REVIEW under `AI_GOVERNANCE.md`.

There is no HTTP controller. VG-040 defines the seam; the endpoints that use it
are VG-041 and the AI tool layer in VG-020. Adding a route here would be public
API surface this task has no acceptance criteria for.

Confirmation is returned, not carried. `CONFIRMATION_REQUIRED` tells a caller
to ask; confirming is a second call. VG-040 issues no confirmation token,
because a token nothing verifies is a security surface with no security in it.

## Tasks that build on this

VG-040 defines the boundary. It supersedes nothing, and none of these are
closed by it:

| Task | Relationship |
| --- | --- |
| VG-009 SmartHomeAdapter interface | Implements and refines adapter behaviour against `SmartHomeAdapter` |
| VG-012 Capability normalization | Normalizes provider capabilities into the canonical vocabulary the registry stores |
| VG-014 / VG-015 / VG-016 | Concrete light / climate / curtain control through `ControlService` |
| VG-020 AI tool schemas | Tools call `ControlService`; they do not reach adapters |
| VG-026 Ambiguity handling | Consumes `AMBIGUOUS` and `CONFIRMATION_REQUIRED` |

## Alternatives considered

**Control methods on `DevicesService`.** Fewer files, and it is where the data
already is. Rejected because there would then be no single place that an
adapter call has to pass through: every new caller would re-implement the
ordering, and the first one to forget the policy step would not fail any test.

**One `Resource` table replacing `Device`.** Tempting, and it removes the
duplication noted above. Rejected for this task: rewriting the model VG-003
established, that VG-005 and VG-006 build on, is not an additive change, and
`AI_GOVERNANCE.md` puts breaking schema changes well outside what an
implementer decides alone.

**Policy as a predicate inside `ControlService`.** Rejected because the rules
are the part a reviewer most needs to read as rules, not infer from the order
of statements in a dispatch method.
