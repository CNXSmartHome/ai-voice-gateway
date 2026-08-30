/**
 * Machine-checkable encoding of the pull request rules in AI_GOVERNANCE.md.
 *
 * These are pure functions so the policy can be unit tested directly, rather
 * than only being exercised by a live workflow run on a real pull request.
 */

/** Facts about a pull request, as reported by the GitHub API. */
export interface PullRequestFacts {
  readonly title: string;
  readonly labels: readonly string[];
  readonly isDraft: boolean;
  /** All required status checks have concluded successfully. */
  readonly checksPassed: boolean;
  /** A required review has been submitted and approved. */
  readonly reviewApproved: boolean;
  /** A reviewer has requested changes, or an unresolved blocking comment exists. */
  readonly changesRequested: boolean;
}

export const RISK_LABELS = ['risk:low', 'risk:medium', 'risk:high'] as const;
export type RiskLabel = (typeof RISK_LABELS)[number];

/** Risk levels the auto-merge policy permits. */
export const AUTO_MERGEABLE_RISK: readonly RiskLabel[] = ['risk:low', 'risk:medium'];

export const HUMAN_APPROVAL_LABEL = 'human:approval-required';

/** Backlog task reference, e.g. `VG-001`. */
const TASK_REFERENCE = /\[(VG-\d{3})\]/;

/**
 * Extracts the backlog task reference from a pull request title.
 *
 * Every pull request must trace to a backlog task; `CLAUDE.md` requires work
 * to be driven by an issue rather than opened ad hoc.
 */
export function extractTaskReference(title: string): string | null {
  return TASK_REFERENCE.exec(title)?.[1] ?? null;
}

export function findRiskLabels(labels: readonly string[]): RiskLabel[] {
  return labels.filter((label): label is RiskLabel =>
    (RISK_LABELS as readonly string[]).includes(label),
  );
}

export function requiresHumanApproval(labels: readonly string[]): boolean {
  return labels.includes(HUMAN_APPROVAL_LABEL);
}

export interface GovernanceResult {
  readonly compliant: boolean;
  readonly violations: readonly string[];
}

/**
 * Validates that a pull request is labelled and titled per governance.
 *
 * This is about metadata hygiene, not merge readiness -- see
 * {@link evaluateAutoMerge} for the latter.
 */
export function validateGovernance(
  pr: Pick<PullRequestFacts, 'title' | 'labels'>,
): GovernanceResult {
  const violations: string[] = [];

  if (extractTaskReference(pr.title) === null) {
    violations.push(
      'Pull request title must reference a backlog task, e.g. "[VG-001] Initialize monorepo".',
    );
  }

  const riskLabels = findRiskLabels(pr.labels);
  if (riskLabels.length === 0) {
    violations.push(`Pull request must carry exactly one risk label (${RISK_LABELS.join(', ')}).`);
  } else if (riskLabels.length > 1) {
    violations.push(`Pull request carries conflicting risk labels: ${riskLabels.join(', ')}.`);
  }

  return { compliant: violations.length === 0, violations };
}

export interface AutoMergeResult {
  readonly eligible: boolean;
  /** Why the pull request is not eligible. Empty when it is. */
  readonly blockers: readonly string[];
}

/**
 * Applies the auto-merge policy from AI_GOVERNANCE.md.
 *
 * Auto-merge is allowed only when ALL are true: CI passes, no blocking review
 * comments, no `human:approval-required` label, risk is low or medium, and the
 * required review is complete.
 *
 * Fails closed: anything unrecognised or missing is a blocker.
 */
export function evaluateAutoMerge(pr: PullRequestFacts): AutoMergeResult {
  const blockers: string[] = [];

  const governance = validateGovernance(pr);
  if (!governance.compliant) {
    blockers.push(...governance.violations);
  }

  if (pr.isDraft) {
    blockers.push('Pull request is a draft.');
  }

  if (!pr.checksPassed) {
    blockers.push('CI has not passed.');
  }

  if (pr.changesRequested) {
    blockers.push('Blocking review comments are unresolved.');
  }

  if (!pr.reviewApproved) {
    blockers.push('Required review is not complete.');
  }

  if (requiresHumanApproval(pr.labels)) {
    blockers.push(
      `Pull request is labelled ${HUMAN_APPROVAL_LABEL}; Product Owner approval is required.`,
    );
  }

  const riskLabels = findRiskLabels(pr.labels);
  const disallowed = riskLabels.filter((label) => !AUTO_MERGEABLE_RISK.includes(label));
  if (disallowed.length > 0) {
    blockers.push(`Risk level ${disallowed.join(', ')} is not eligible for auto-merge.`);
  }

  return { eligible: blockers.length === 0, blockers };
}
