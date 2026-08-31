# CI Pipeline

The CI pipeline is the deterministic quality gate described in
`AI_GOVERNANCE.md`. It is what allows Claude to operate autonomously: the
policy is enforced by the pipeline rather than by anyone remembering to check.

## Workflows

| Workflow | File | Triggers | Purpose |
| --- | --- | --- | --- |
| Quality Gate | `quality-gate.yml` | PR, push to `main` | Policy checks, lint, format, typecheck, tests, build, dependency audit |
| Firmware | `firmware.yml` | PR, push to `main` | Host tests for the pure-C firmware policy, and an ESP-IDF compile |
| PR Governance | `pr-governance.yml` | PR opened/edited/labeled | Enforces title task reference and risk labelling |
| Security | `security.yml` | PR, push to `main`, weekly | CodeQL analysis and dependency review |
| Auto-merge | `auto-merge.yml` | Review submitted, label changed | Enables native auto-merge when the policy is satisfied |

### Quality Gate

Three independent jobs, so a lint failure and an audit failure surface
together rather than one hiding the other.

- **Repository policy** — required governance documents exist; no `.env`
  file, private key, or filled-in factory provisioning CSV is tracked.
- **Lint, typecheck, test, build** — the same commands developers run locally.
  Runs a PostgreSQL 16 service container so the database integration tests
  execute against a real database rather than a mock. The container is
  reachable only from the job and its credentials are throwaway.
- **Dependency audit** — production dependencies must be clean at any
  severity (`--audit-level=low`, blocking). The dev-dependency audit is
  advisory, since dev packages do not ship to a runtime.

### Firmware

Two jobs, mirroring how the firmware is split (VG-007).

- **Firmware host tests** — configures, builds, and runs
  `firmware/vg100/test/host` with a stock compiler. The provisioning policy
  is pure C precisely so that this is possible: the decisions worth asserting
  about — when credentials are kept, how the backoff grows, when provisioning
  reopens — are tested in seconds, with no toolchain and no board.
- **Firmware build** — compiles `firmware/vg100` for `esp32s3` inside
  `espressif/idf:v5.5`, so a change that breaks the ESP-IDF build fails the
  pull request rather than the next person to flash a device. The image tag
  is pinned: a firmware build that follows the latest ESP-IDF is one nobody
  can reproduce.

Neither job is filtered by path. The host tests take seconds; the ESP-IDF
build costs a few minutes on pull requests that do not touch firmware, which
is the price of both being required checks that always report. A path filter
would make them skip, and a required check that never reports blocks a merge
forever.

### PR Governance

Enforces two rules from `AI_GOVERNANCE.md`:

1. The title references a backlog task, e.g. `[VG-001] Initialize monorepo`.
2. Exactly one `risk:` label is present — zero is unlabelled, more than one is
   ambiguous.

The rules live in `tools/governance` as pure, unit-tested functions rather
than as shell script inside YAML, so a policy change is a reviewable code
change with tests attached.

### Security

- **CodeQL** — `security-and-quality` queries for JavaScript/TypeScript,
  reporting to the Security tab. Also runs weekly, so advisories published
  after a merge are still caught.
- **Dependency review** — fails a PR that introduces a dependency with a known
  vulnerability, at `low` severity and above.

### Auto-merge

Implements the auto-merge policy exactly as written in `AI_GOVERNANCE.md`.
Auto-merge is enabled only when **all** of these hold:

- CI passes
- no blocking review comments
- no `human:approval-required` label
- risk is `low` or `medium`
- the required review is complete

Two properties matter here:

- **It never merges directly.** It only enables GitHub's native auto-merge, so
  branch protection remains the final authority. The policy check is a second
  gate, not the only one.
- **It fails closed.** A missing label, an in-flight check, an empty check
  set, or an unrecognised review state all count as blockers.

Fork pull requests are ignored, so the workflow never evaluates a policy over
code the repository does not control.

## Running the checks locally

CI runs nothing that cannot be run locally:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run prisma:migrate --workspace @vg/api   # requires DATABASE_URL
npm run test:unit
npm run test:integration
npm run build
npm audit --omit=dev --audit-level=low
```

The governance policy can be exercised directly:

```bash
npm run build --workspace @vg/governance
echo '{"title":"[VG-002] CI baseline","labels":["risk:low"],"checksPassed":true,"reviewApproved":true}' \
  | node tools/governance/dist/cli.js automerge
```

The firmware host tests need a C compiler and CMake, and nothing else:

```bash
cmake -S firmware/vg100/test/host -B build/firmware-host -DCMAKE_BUILD_TYPE=Debug
cmake --build build/firmware-host
ctest --test-dir build/firmware-host --output-on-failure
```

The ESP-IDF build needs the toolchain. A machine without one — a Windows
workstation, for instance — can borrow the same container CI uses, on the
remote Docker host described below:

```bash
docker run --rm -v "$PWD":/w -w /w/firmware/vg100 espressif/idf:v5.5 \
  bash -c '. "$IDF_PATH/export.sh" && idf.py set-target esp32s3 && idf.py build'
```

The image is large — roughly 12 GB unpacked, since it carries a toolchain for
every target — so it is worth pulling once rather than per build. The build
writes `firmware/vg100/build/` as root when run this way; it is git-ignored,
but removing it needs the same container.

## Repository settings

These are repository settings rather than files, so they are recorded here for
auditability. **All of them are applied**, with one exception: VG-007 adds
`Firmware host tests` and `Firmware build` to the required checks below, and
branch protection has to be re-applied for those to take effect. Until it is,
the two jobs run and report but do not gate a merge.

### Branch protection for `main`

Applied from `docs/branch-protection.json`:

```bash
gh api -X PUT repos/CNXSmartHome/ai-voice-gateway/branches/main/protection \
  --input docs/branch-protection.json
```

| Setting | Value |
| --- | --- |
| Require a pull request before merging | yes |
| Required approving reviews | **0** — see below |
| Require conversation resolution | yes |
| Require status checks, branch up to date | yes |
| Required checks | `Repository policy`, `Lint, typecheck, test, build`, `Dependency audit`, `Firmware host tests`, `Firmware build`, `Title and label policy`, `CodeQL` |
| Include administrators | yes |
| Force pushes / deletions | disabled |

**Why zero required approvals.** The repository currently has one human
collaborator, who is also the author of every pull request. GitHub does not
allow approving your own pull request, so requiring one approval — with
administrators included and no bypass — would deadlock the repository: nothing
could ever merge.

Zero approvals does not mean no gate. A pull request is still required, every
status check above must pass, conversations must be resolved, and
administrators are not exempt. The gate is the pipeline, which is the model
`AI_GOVERNANCE.md` describes.

**When a second collaborator joins**, raise the bar to match the governance
document by setting `required_approving_review_count` to `1` and
`require_code_owner_reviews` to `true` in `docs/branch-protection.json`, then
re-applying it.

Note that until then, `auto-merge.yml` will not fire: it requires
`reviewDecision == APPROVED`, which a self-authored pull request cannot reach.
That is the fail-closed behaviour working as intended — pull requests get
merged deliberately, by a person, once CI is green.

### Security and analysis

| Setting | State |
| --- | --- |
| Dependency graph | enabled — required by dependency review |
| Dependabot alerts | enabled |
| Dependabot security updates | enabled |
| Secret scanning | enabled |
| Secret scanning push protection | enabled |

Push protection is worth calling out: it blocks a secret at push time rather
than reporting it after the fact, which is the difference between a near miss
and a credential rotation.

### Pull requests

| Setting | State |
| --- | --- |
| Allow auto-merge | enabled — `auto-merge.yml` depends on it |
| Automatically delete head branches | enabled |
| Allow squash merging | enabled |

### This repository is public

Everything here — code, issues, pull requests, CI logs — is world-readable.
That raises the stakes on the secrets policy in `AI_GOVERNANCE.md`: a
credential committed here is disclosed the moment it is pushed, and must be
treated as compromised and rotated rather than merely removed from history.

## Database in CI

The integration tests that touch the schema require `DATABASE_URL`. CI sets it
to the service container; locally, tests that need a database skip themselves
with a warning rather than failing, so a developer without PostgreSQL still
gets a green unit run.

That skip is deliberate and narrow: it applies only to suites that need real
rows. Others stub the Prisma service and always run. **In CI the database
tests never skip**, because `DATABASE_URL` is always set there — a change that
breaks a constraint or a cascade fails the build.

## Running the database tests locally

The skip is a safety net, not a plan. Letting CI be the first place these run
has cost real time: a defect in VG-003 and a broken test fixture in VG-005
each took a round-trip to find, and both would have surfaced in seconds
locally.

`docker-compose.yml` describes the right database. If Docker runs on the same
machine:

```bash
docker compose up -d
export DATABASE_URL='postgresql://vg:vg@127.0.0.1:5432/vg_dev?schema=public'
npm run --workspace @vg/api prisma:migrate
npm run test:integration
```

### On a remote Docker host

A development machine without Docker — a Windows workstation, for instance —
can use one elsewhere on the network. Copy the compose file to the host and
start it there:

```bash
scp docker-compose.yml <host>:~/ai-voice-gateway/docker-compose.yml
ssh <host> 'cd ~/ai-voice-gateway && docker compose -p vg up -d'
```

Then forward the port, and treat it as if it were local:

```bash
ssh -f -N -L 127.0.0.1:5432:127.0.0.1:5432 <host>
export DATABASE_URL='postgresql://vg:vg@127.0.0.1:5432/vg_dev?schema=public'
npm run --workspace @vg/api prisma:migrate
npm run test:integration
```

**Use a tunnel rather than publishing the port.** `docker-compose.yml` binds
`127.0.0.1` on purpose, and a database on a shared network should not be the
exception to that. The tunnel keeps it on loopback at both ends, so the
throwaway credentials in the compose file stay throwaway. Changing the bind to
`0.0.0.0` would put an unauthenticated-by-default database on the LAN.

**`-p vg` matters** if the host runs other compose projects: without it, an
unrelated stack can be adopted or torn down by these commands.

Two things to know:

- The compose file in this repository is the source of truth. A copy on a
  remote host **will drift** when it changes here; re-copy it rather than
  editing it there.
- Host names, addresses, and keys belong in your own `~/.ssh/config` and a
  gitignored `.env`, never in this repository.
- One database serving several branches accumulates their migrations. Moving
  to a branch whose migrations are a subset leaves the schema ahead of it,
  which `migrate deploy` reports as nothing to do rather than as a problem.
  When that matters, start clean:

  ```bash
  ssh <host> 'cd ~/ai-voice-gateway && docker compose -p vg down -v && docker compose -p vg up -d'
  ```

  Safe to do at any time — this database holds nothing anyone should keep.

Nothing about this is a deployment. It is a development database, and
`docs/ARCHITECTURE.md` is unchanged: STAGING and PRODUCTION are still
CI/CD-only, per `AI_GOVERNANCE.md`.

## Why the policy is code

`AI_GOVERNANCE.md` is prose written for people. `tools/governance` is the same
rules expressed so a machine can apply them consistently, with tests covering
the cases that matter — conflicting risk labels, a missing task reference, a
`human:approval-required` PR that otherwise looks mergeable.

When the two disagree, `AI_GOVERNANCE.md` wins and the code is the bug.
