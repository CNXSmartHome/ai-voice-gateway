# AI Voice Gateway Starter Pack

This repository starter pack is designed for a founder-light development workflow using:
- ChatGPT as Technical Lead / Architect / Reviewer
- Claude Code as primary implementation agent
- GitHub as the single source of truth
- CI/CD as deterministic quality and deployment gate

## Start here
1. Create a new GitHub repository.
2. Copy this starter pack into the repo.
3. Commit to `main`.
4. Create GitHub labels matching `AI_GOVERNANCE.md`.
5. Import `docs/BACKLOG.csv` into GitHub Project or create issues from it.
6. Assign READY tasks to Claude.
7. Open Claude Code in the repository and instruct it to read `CLAUDE.md`.

## Suggested labels
- status:READY
- status:IN_PROGRESS
- status:REVIEW
- status:BLOCKED
- status:DONE
- priority:P0/P1/P2/P3
- risk:low/medium/high
- area:firmware/backend/mobile/integration/ai/infra/qa/security
- ai:auto
- ai:review-required
- human:approval-required

## Recommended first task
VG-001 Initialize monorepo.
