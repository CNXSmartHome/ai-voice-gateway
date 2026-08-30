# CI Pipeline

The CI pipeline is the deterministic quality gate described in
`AI_GOVERNANCE.md`. It is what allows Claude to operate autonomously: the
policy is enforced by the pipeline rather than by anyone remembering to check.

## Workflows

| Workflow | File | Triggers | Purpose |
| --- | --- | --- | --- |
| Quality Gate | `quality-gate.yml` | PR, push to `main` | Policy checks, lint, format, typecheck, tests, build, dependency audit |
| PR Governance | `pr-governance.yml` | PR opened/edited/labeled | Enforces title task reference and risk labelling |
| Security | `security.yml` | PR, push to `main`, weekly | CodeQL analysis and dependency review |
| Auto-merge | `auto-merge.yml` | Review submitted, label changed | Enables native auto-merge when the policy is satisfied |

### Quality Gate

Three independent jobs, so a lint failure and an audit failure surface
together rather than one hiding the other.

- **Repository policy** — required governance documents exist; no `.env` file
  or private key is tracked.
- **Lint, typecheck, test, build** — the same commands developers run locally.
  Runs a PostgreSQL 16 service container so the database integration tests
  execute against a real database rather than a mock. The container is
  reachable only from the job and its credentials are throwaway.
- **Dependency audit** — production dependencies must be clean at any
  severity (`--audit-level=low`, blocking). The dev-dependency audit is
  advisory, since dev packages do not ship to a runtime.

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

## Repository settings

These are repository settings rather than files, so they are recorded here for
auditability. **All of them are applied.**

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
| Required checks | `Repository policy`, `Lint, typecheck, test, build`, `Dependency audit`, `Title and label policy`, `CodeQL` |
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

That skip is deliberate and narrow: it applies only to
`database.integration-spec.ts`. The health endpoint integration tests stub the
Prisma service and always run. **In CI the database tests never skip**, because
`DATABASE_URL` is always set there — a change that breaks a constraint or a
cascade fails the build.

## Why the policy is code

`AI_GOVERNANCE.md` is prose written for people. `tools/governance` is the same
rules expressed so a machine can apply them consistently, with tests covering
the cases that matter — conflicting risk labels, a missing task reference, a
`human:approval-required` PR that otherwise looks mergeable.

When the two disagree, `AI_GOVERNANCE.md` wins and the code is the bug.
