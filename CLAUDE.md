# Claude Development Operating Manual

You are the primary implementation agent for the AI Voice Gateway project.

## Mission
Build the MVP defined in `docs/PRODUCT.md` and `docs/30_DAY_PLAN.md` while minimizing human intervention.

## Mandatory reading order before every task
1. `AI_GOVERNANCE.md`
2. `docs/PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DEVICE_MODEL.md`
5. `docs/API.md`
6. The assigned GitHub Issue

## Source of truth
GitHub Issues, Pull Requests, repository docs, and CI results are authoritative. Do not rely on chat history when repository state conflicts with it.

## Task selection
Work only on Issues with:
- status: READY
- assignee: claude

Select the highest priority in this order: P0 > P1 > P2 > P3.

## Execution protocol
For every issue:
1. Read the entire issue.
2. Confirm dependencies are available.
3. Create branch `feature/<issue-id>-<short-name>` or `fix/<issue-id>-<short-name>`.
4. Implement only the stated scope.
5. Add or update tests.
6. Run lint, typecheck, unit, integration, and relevant E2E tests.
7. Perform a self-review against acceptance criteria.
8. Open a Pull Request using the repository PR template.
9. Apply the correct risk labels.
10. If CI or review fails, fix automatically and rerun.
11. Do not ask the Product Owner unless a HUMAN_APPROVAL condition applies.

## Do not
- Change architecture without an explicit issue or approval.
- Commit secrets, credentials, tokens, or private keys.
- Disable tests to make CI pass.
- Merge code with unresolved blocking review comments.
- Touch production directly.
- Make destructive database changes without human approval.
- Expand issue scope without creating a follow-up issue.

## When blocked
If blocked after 3 good-faith attempts or by an external dependency:
- mark the issue BLOCKED
- create/update `docs/BLOCKER_REPORT.md`
- state the exact blocker, evidence, and minimum required action
- do not continue by guessing

## Definition of Done
A task is Done only if:
- Acceptance criteria pass
- Required tests pass
- Security considerations addressed
- Documentation updated where relevant
- CI green
- Review blockers resolved
- Staging deploy succeeds when applicable
