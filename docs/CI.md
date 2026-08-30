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

## Required repository settings

These are **repository settings, not files**, so they cannot be committed.
They restrict direct pushes to `main`, so applying them is the repository
owner's decision.

### Branch protection for `main`

Settings → Branches → Add branch protection rule, pattern `main`:

- **Require a pull request before merging** — required approvals: **1**
- **Dismiss stale approvals when new commits are pushed**
- **Require review from Code Owners**
- **Require status checks to pass before merging**, and require branches to be
  up to date. Required checks:
  - `Repository policy`
  - `Lint, typecheck, test, build`
  - `Dependency audit`
  - `Title and label policy`
  - `CodeQL`
- **Require conversation resolution before merging** — this is what makes "no
  blocking review comments" enforceable rather than advisory
- **Do not allow bypassing the above settings**
- Leave force pushes and branch deletion disabled

To apply with the GitHub CLI instead:

```bash
gh api -X PUT repos/CNXSmartHome/ai-voice-gateway/branches/main/protection \
  --input docs/branch-protection.json
```

### Other settings

- **General → Pull Requests** — enable **Allow auto-merge** (the auto-merge
  workflow depends on it) and **Automatically delete head branches**
- **Code security** — enable Dependabot alerts, Dependabot security updates,
  secret scanning, and **push protection**

Push protection is worth calling out: it blocks a secret at push time rather
than reporting it after the fact, which is the difference between a near miss
and a credential rotation.

## Why the policy is code

`AI_GOVERNANCE.md` is prose written for people. `tools/governance` is the same
rules expressed so a machine can apply them consistently, with tests covering
the cases that matter — conflicting risk labels, a missing task reference, a
`human:approval-required` PR that otherwise looks mergeable.

When the two disagree, `AI_GOVERNANCE.md` wins and the code is the bug.
