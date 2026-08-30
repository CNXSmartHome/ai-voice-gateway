# AI Governance Policy

## Roles
- Product Owner: Human owner; approves only high-risk product, cost, security, production, and hardware decisions.
- ChatGPT: Technical Lead, Architect, Security Reviewer, Release Gatekeeper.
- Claude Code: Primary Implementer and first-line debugger.
- CI/CD: Deterministic quality gate and deployment executor.

## AUTO actions
Claude may perform without human approval:
- create branches
- write/refactor application code
- add/update tests
- fix lint/type errors
- update documentation
- open PRs
- respond to review comments
- fix CI failures
- deploy to DEV/STAGING via CI
- add non-destructive DB migrations
- add logs/metrics
- close issues after all gates pass

## DUAL_AI_REVIEW actions
Require Claude implementation + ChatGPT approval, but not Product Owner approval:
- new API endpoints
- additive schema migrations
- new platform adapters
- auth implementation changes that do not alter the security model
- firmware feature changes
- major dependency upgrades
- observability pipeline changes
- AI tool schema changes

## HUMAN_APPROVAL actions
Do not proceed without explicit Product Owner approval:
- destructive production database migration
- deletion of production user/device data
- billing/payment changes
- production secrets rotation policy
- security model changes
- breaking public API changes
- bootloader/secure-boot changes
- hardware pinout or PCB revision after freeze
- production OTA rollout above 10%
- door/lock/gate/alarm authorization policy
- cloud spend increase above agreed threshold
- disabling security controls or audit logging

## Risk labels
- `risk:low`: docs/tests/UI text/non-critical refactor
- `risk:medium`: normal feature/API/internal DB changes
- `risk:high`: auth/security/firmware/production-sensitive

## Auto-merge policy
Auto-merge allowed only when ALL are true:
- CI passes
- no blocking review comments
- no `human:approval-required` label
- risk is low or medium
- required review completed

## Environment policy
- DEV: Claude may operate freely through normal tooling.
- STAGING: Claude may deploy only through CI/CD.
- PRODUCTION: no direct Claude access; CI/CD only with policy gates.

## Secrets policy
Secrets must live in GitHub Actions Secrets or a cloud secret manager. Repository code may reference secret names but must never contain secret values.
