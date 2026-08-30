# ADR 0001: NestJS as the backend framework

- **Status:** Accepted
- **Date:** 2026-08-30
- **Task:** VG-001
- **Decision maker:** Claude Code (implementation agent)

## Context

`docs/ARCHITECTURE.md` specifies the backend as "FastAPI or NestJS" and leaves
the choice open. VG-001 initializes the monorepo, so the choice has to be made
before any workspace tooling exists.

Relevant constraints:

- Mobile is React Native (TypeScript) per `docs/ARCHITECTURE.md`.
- The universal device model must be shared, unmodified, between the API, the
  orchestrator, the adapter layer, and the AI tool schemas
  (`docs/DEVICE_MODEL.md`).
- The 30-day MVP deadline rewards a single toolchain over the best-fit
  toolchain per component.

## Decision

Use **NestJS** with TypeScript, in an npm-workspaces monorepo.

## Consequences

**Positive**

- One language, one linter, one test runner, and one typechecker across API and
  mobile. CI stays a single job matrix (VG-002).
- `packages/domain` is imported directly by both API and mobile, so the
  canonical capability list cannot drift between them — the normalization
  boundary is enforced by the compiler rather than by convention.
- NestJS modules map cleanly onto the five services in
  `docs/ARCHITECTURE.md`, and its WebSocket gateway support covers VG-006 and
  VG-019 without a second framework.

**Negative**

- Python's audio and ML ecosystem is not directly available to the backend. The
  realtime AI work (VG-019) is provider-API-driven rather than local inference,
  so this is not expected to bind; if it does, the AI Session Service is
  separable as its own service.
- NestJS carries more structural ceremony than FastAPI for small endpoints.

**Neutral**

- npm workspaces, rather than pnpm or Turborepo, because npm ships with Node and
  needs no extra install step in CI or on a fresh developer machine.

## Alternatives considered

- **FastAPI** — a better fit if the AI pipeline needed in-process Python audio
  processing. It does not for the MVP, and it would add a second toolchain,
  second CI setup, and a duplicated hand-maintained device model.
- **Split stack (FastAPI for AI, NestJS for API)** — deferred. Reasonable
  post-MVP if the AI service's needs diverge; premature now.

## Version selection (VG-001)

Pinned to **NestJS 11.x**, not 12.x.

NestJS 12 is published as pure ESM (`"type": "module"`, no CommonJS build).
Adopting it would require the whole backend, plus Jest, to move to ESM, and
Jest's ESM support still requires `--experimental-vm-modules`. NestJS 11 is
CommonJS, is compatible with the ts-jest toolchain used across the monorepo,
and reports **zero** npm advisories in both the production and full dependency
trees.

NestJS 10 was rejected: its `@nestjs/platform-express` pulls `multer` and `qs`
versions carrying high- and moderate-severity denial-of-service advisories.

Moving to NestJS 12 and ESM is a deliberate follow-up, not incidental work. It
qualifies as a major dependency upgrade under `AI_GOVERNANCE.md`
(DUAL_AI_REVIEW) and should be raised as its own issue.
