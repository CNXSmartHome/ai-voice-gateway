import {
  AUTO_MERGEABLE_RISK,
  HUMAN_APPROVAL_LABEL,
  type PullRequestFacts,
  evaluateAutoMerge,
  extractTaskReference,
  findRiskLabels,
  requiresHumanApproval,
  validateGovernance,
} from '../src/pull-request';

/** A pull request that satisfies every auto-merge condition. */
const mergeable: PullRequestFacts = {
  title: '[VG-001] Initialize monorepo',
  labels: ['status:REVIEW', 'priority:P0', 'risk:low', 'area:infra', 'ai:auto'],
  isDraft: false,
  checksPassed: true,
  reviewApproved: true,
  changesRequested: false,
};

describe('extractTaskReference', () => {
  it.each([
    ['[VG-001] Initialize monorepo', 'VG-001'],
    ['[VG-038] Final acceptance checklist', 'VG-038'],
    ['fix: something [VG-012] mid-title', 'VG-012'],
  ])('extracts the task from %p', (title, expected) => {
    expect(extractTaskReference(title)).toBe(expected);
  });

  it.each([
    ['Initialize monorepo'],
    ['VG-001 Initialize monorepo'],
    ['[VG-1] too few digits'],
    ['[VG-0001] too many digits'],
    ['[XX-001] wrong prefix'],
    [''],
  ])('returns null for %p', (title) => {
    expect(extractTaskReference(title)).toBeNull();
  });
});

describe('findRiskLabels', () => {
  it('finds a single risk label', () => {
    expect(findRiskLabels(['area:infra', 'risk:medium'])).toEqual(['risk:medium']);
  });

  it('finds conflicting risk labels', () => {
    expect(findRiskLabels(['risk:low', 'risk:high'])).toEqual(['risk:low', 'risk:high']);
  });

  it('returns empty when none are present', () => {
    expect(findRiskLabels(['area:infra', 'ai:auto'])).toEqual([]);
  });

  it('does not match a label that merely contains a risk name', () => {
    expect(findRiskLabels(['norisk:low', 'risk:lowest'])).toEqual([]);
  });
});

describe('requiresHumanApproval', () => {
  it('detects the approval label', () => {
    expect(requiresHumanApproval(['risk:high', HUMAN_APPROVAL_LABEL])).toBe(true);
  });

  it('is false when absent', () => {
    expect(requiresHumanApproval(['risk:low'])).toBe(false);
  });
});

describe('validateGovernance', () => {
  it('passes a well-formed pull request', () => {
    const result = validateGovernance(mergeable);

    expect(result.compliant).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a title with no task reference', () => {
    const result = validateGovernance({ ...mergeable, title: 'Initialize monorepo' });

    expect(result.compliant).toBe(false);
    expect(result.violations.join(' ')).toMatch(/backlog task/);
  });

  it('rejects a pull request with no risk label', () => {
    const result = validateGovernance({ ...mergeable, labels: ['area:infra'] });

    expect(result.compliant).toBe(false);
    expect(result.violations.join(' ')).toMatch(/exactly one risk label/);
  });

  it('rejects conflicting risk labels', () => {
    const result = validateGovernance({ ...mergeable, labels: ['risk:low', 'risk:high'] });

    expect(result.compliant).toBe(false);
    expect(result.violations.join(' ')).toMatch(/conflicting risk labels/);
  });

  it('reports every violation at once rather than stopping at the first', () => {
    const result = validateGovernance({ title: 'no reference', labels: [] });

    expect(result.violations).toHaveLength(2);
  });
});

describe('evaluateAutoMerge', () => {
  it('allows a fully compliant pull request', () => {
    const result = evaluateAutoMerge(mergeable);

    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it.each(AUTO_MERGEABLE_RISK)('allows %s', (risk) => {
    expect(evaluateAutoMerge({ ...mergeable, labels: [risk] }).eligible).toBe(true);
  });

  it('blocks risk:high', () => {
    const result = evaluateAutoMerge({ ...mergeable, labels: ['risk:high'] });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/risk:high is not eligible/);
  });

  it('blocks a pull request needing Product Owner approval', () => {
    const result = evaluateAutoMerge({
      ...mergeable,
      labels: ['risk:low', HUMAN_APPROVAL_LABEL],
    });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/Product Owner approval/);
  });

  it('blocks when CI has not passed', () => {
    const result = evaluateAutoMerge({ ...mergeable, checksPassed: false });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/CI has not passed/);
  });

  it('blocks when changes are requested', () => {
    const result = evaluateAutoMerge({ ...mergeable, changesRequested: true });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/Blocking review comments/);
  });

  it('blocks when the required review is incomplete', () => {
    const result = evaluateAutoMerge({ ...mergeable, reviewApproved: false });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/Required review is not complete/);
  });

  it('blocks a draft', () => {
    const result = evaluateAutoMerge({ ...mergeable, isDraft: true });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/draft/);
  });

  it('inherits governance violations as blockers', () => {
    const result = evaluateAutoMerge({ ...mergeable, title: 'no task reference' });

    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/backlog task/);
  });

  it('fails closed on an unlabelled, unreviewed, failing pull request', () => {
    const result = evaluateAutoMerge({
      title: 'wip',
      labels: [],
      isDraft: true,
      checksPassed: false,
      reviewApproved: false,
      changesRequested: true,
    });

    expect(result.eligible).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(6);
  });
});
