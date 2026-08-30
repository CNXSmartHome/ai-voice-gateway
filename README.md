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
  vg100/          ESP32-S3 / ESP-IDF firmware (reserved - VG-007)
docs/             Product, architecture, API, and device model specs
  CI.md           Pipeline reference and required repository settings
  adr/            Architecture decision records
.github/          Issue templates, PR template, CI workflows
```

`apps/mobile` and `firmware/vg100` are placeholders reserved for their tasks.
They are deliberately outside the npm workspace until initialized.

## Requirements

- Node.js 20.11.0 or newer (see `.nvmrc`)
- npm 10 or newer

PostgreSQL and Redis are introduced with the database schema task (VG-003).

## Getting started

```bash
npm install
cp .env.example .env    # fill in local values; never commit this file
npm run build
```

Run the API:

```bash
npm run build
node apps/api/dist/main.js
# or, for development
npm run start:dev --workspace @vg/api
```

Verify it is up:

```bash
curl http://127.0.0.1:3000/v1/health
# {"status":"ok","service":"ai-voice-gateway-api","version":"0.1.0","uptimeSeconds":1}
```

## Checks

The same commands run locally and in CI (`.github/workflows/quality-gate.yml`):

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
