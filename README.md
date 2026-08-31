# AI Voice Gateway

A cloud-first smart-home voice gateway: a VG-100 device plus a mobile app that
connects third-party smart-home platforms and lets users control devices by
voice.

See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the MVP specification and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design.

## Development workflow

This repository uses a founder-light workflow:

- **ChatGPT** — Technical Lead / Architect / Reviewer
- **Claude Code** — primary implementation agent
- **GitHub** — single source of truth
- **CI/CD** — deterministic quality and deployment gate

Governance rules, including which actions require human approval, are in
[`AI_GOVERNANCE.md`](AI_GOVERNANCE.md). The implementation agent's operating
manual is [`CLAUDE.md`](CLAUDE.md).

## Repository layout

```
apps/
  api/            NestJS cloud API service
  mobile/         React Native app          (reserved - VG-008)
packages/
  domain/         Universal device model shared across services
tools/
  governance/     AI_GOVERNANCE.md pull request policy, enforced by CI
firmware/
  vg100/          ESP32-S3 / ESP-IDF gateway firmware
docs/             Product, architecture, API, and device model specs
  CI.md           Pipeline reference and required repository settings
  adr/            Architecture decision records
.github/          Issue templates, PR template, CI workflows
```

`apps/mobile` is a placeholder reserved for VG-008. `firmware/vg100` builds
with ESP-IDF and its own toolchain. Both are deliberately outside the npm
workspace, so `npm install` and `npm run build` stay unaffected by them.

## Requirements

- Node.js 20.11.0 or newer (see `.nvmrc`)
- npm 10 or newer
- PostgreSQL 16 — to run the API or the database integration tests. A
  `docker-compose.yml` is provided for local use.

Redis is not used yet; no MVP task depends on it.

## Getting started

```bash
npm install
cp .env.example .env    # fill in local values; never commit this file
```

Start PostgreSQL and set `DATABASE_URL` in `.env`:

```bash
docker compose up -d postgres
# DATABASE_URL=postgresql://vg:vg@127.0.0.1:5432/vg_dev?schema=public
```

Apply the schema, then build:

```bash
npm run prisma:migrate --workspace @vg/api
npm run build
```

Run the API:

```bash
node apps/api/dist/main.js
# or, for development
npm run start:dev --workspace @vg/api
```

Verify it is up:

```bash
curl http://127.0.0.1:3000/v1/health
# {"status":"ok","service":"ai-voice-gateway-api","version":"0.1.0","uptimeSeconds":1}

curl http://127.0.0.1:3000/v1/health/ready
# {"status":"ready","service":"ai-voice-gateway-api","checks":{"database":"up"}}
```

`/v1/health` is liveness and never touches a dependency. `/v1/health/ready`
is readiness and returns 503 when the database is unreachable, so a load
balancer removes the instance instead of sending it requests it cannot serve.

## Database

The schema lives in `apps/api/prisma/schema.prisma` and models the hierarchy
in [`docs/DEVICE_MODEL.md`](docs/DEVICE_MODEL.md): Organization → Property →
Room → Gateway / Device.

| Command | Purpose |
| --- | --- |
| `npm run prisma:migrate --workspace @vg/api` | Apply committed migrations |
| `npm run prisma:generate --workspace @vg/api` | Regenerate the client |
| `npm run prisma:studio --workspace @vg/api` | Browse data locally |

Storage enums are SCREAMING_SNAKE_CASE; the domain uses the canonical
lowercase names. `apps/api/src/database/domain-mapping.ts` is the only place
that knows both, and tests assert the two never drift.

## Firmware

The VG-100 gateway firmware is in [`firmware/vg100`](firmware/vg100) and
builds with ESP-IDF v5.5, not npm. Its provisioning policy — when Wi-Fi
credentials are kept, how reconnection backs off, when provisioning reopens —
is pure C with no ESP-IDF dependency, so it is tested on a host compiler
rather than on a board:

```bash
cmake -S firmware/vg100/test/host -B build/firmware-host
cmake --build build/firmware-host
ctest --test-dir build/firmware-host --output-on-failure
```

CI runs those and an ESP-IDF compile for `esp32s3`. See
[`firmware/vg100/README.md`](firmware/vg100/README.md) for the provisioning
behaviour, the partition layout, and what manufacturing has to write to each
device.

## Checks

The same commands run locally and in CI (`.github/workflows/quality-gate.yml`
and `.github/workflows/firmware.yml`):

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint across all workspaces |
| `npm run format:check` | Prettier verification (code only; specs excluded) |
| `npm run typecheck` | TypeScript, including test sources |
| `npm run test:unit` | Unit tests |
| `npm run test:integration` | Integration tests |
| `npm test` | All tests |
| `npm run build` | Compile all workspaces |

Run everything before opening a pull request.

CI runs these same commands plus CodeQL analysis, dependency review, and the
governance policy checks. See [`docs/CI.md`](docs/CI.md) for the full pipeline
and the branch-protection settings the repository owner must apply.

## Pull request rules

CI enforces two rules from [`AI_GOVERNANCE.md`](AI_GOVERNANCE.md):

1. The PR title references a backlog task, e.g. `[VG-001] Initialize monorepo`.
2. Exactly one `risk:` label is present.

Those rules live in `tools/governance` as unit-tested functions, so changing
the policy is a reviewable code change rather than an edit to a YAML script.

## The device model is a contract

[`docs/DEVICE_MODEL.md`](docs/DEVICE_MODEL.md) is the specification;
`packages/domain` is its implementation, and
`packages/domain/test/device-model-doc.spec.ts` fails if the two drift apart.
Changing one means changing both.

Only canonical capability names may reach the AI tool layer. Provider-specific
names are normalized inside the adapter layer — see the non-negotiable
boundaries in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Secrets

Never commit secrets. `.env` is git-ignored and CI fails if a `.env` file or
private key is ever tracked. `.env.example` lists variable **names** only.
Real values belong in GitHub Actions Secrets or a cloud secret manager, per the
secrets policy in [`AI_GOVERNANCE.md`](AI_GOVERNANCE.md).

## Labels

GitHub labels mirror `AI_GOVERNANCE.md`:

- `status:READY` / `IN_PROGRESS` / `REVIEW` / `BLOCKED` / `DONE`
- `priority:P0` / `P1` / `P2` / `P3`
- `risk:low` / `medium` / `high`
- `area:firmware` / `backend` / `mobile` / `integration` / `ai` / `infra` / `qa` / `security`
- `ai:auto`, `ai:review-required`, `human:approval-required`

## Backlog

The 30-day MVP plan is in [`docs/30_DAY_PLAN.md`](docs/30_DAY_PLAN.md) and the
task list in [`docs/BACKLOG.csv`](docs/BACKLOG.csv).
