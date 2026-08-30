import { parseFacts, run } from '../src/cli';

const compliant = JSON.stringify({
  title: '[VG-002] CI baseline',
  labels: [{ name: 'risk:low' }, { name: 'ai:auto' }],
  isDraft: false,
  checksPassed: true,
  reviewApproved: true,
  changesRequested: false,
});

describe('parseFacts', () => {
  it('accepts gh label objects', () => {
    const facts = parseFacts(compliant);

    expect(facts.labels).toEqual(['risk:low', 'ai:auto']);
  });

  it('accepts plain string labels', () => {
    const facts = parseFacts(JSON.stringify({ title: '[VG-001] x', labels: ['risk:low'] }));

    expect(facts.labels).toEqual(['risk:low']);
  });

  it('defaults missing booleans to false so unknown state fails closed', () => {
    const facts = parseFacts(JSON.stringify({ title: '[VG-001] x', labels: [] }));

    expect(facts.checksPassed).toBe(false);
    expect(facts.reviewApproved).toBe(false);
    expect(facts.isDraft).toBe(false);
    expect(facts.changesRequested).toBe(false);
  });

  it('ignores malformed label entries', () => {
    const facts = parseFacts(
      JSON.stringify({ title: '[VG-001] x', labels: ['risk:low', 42, null, {}] }),
    );

    expect(facts.labels).toEqual(['risk:low']);
  });

  it('treats a missing labels field as no labels', () => {
    expect(parseFacts(JSON.stringify({ title: '[VG-001] x' })).labels).toEqual([]);
  });

  it.each([['null'], ['"a string"'], ['[]']])('rejects non-object payload %s', (raw) => {
    expect(() => parseFacts(raw)).toThrow();
  });

  it('rejects a missing title', () => {
    expect(() => parseFacts(JSON.stringify({ labels: [] }))).toThrow(/title/);
  });
});

describe('run', () => {
  it('exits zero when validation passes', () => {
    const result = run('validate', compliant);

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/passed/);
  });

  it('exits non-zero when validation fails', () => {
    const result = run('validate', JSON.stringify({ title: 'no reference', labels: [] }));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/Governance check failed/);
  });

  it('reports auto-merge eligibility without failing the job', () => {
    const result = run('automerge', compliant);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('eligible=true');
  });

  it('reports ineligibility as data, not as a failure', () => {
    const blocked = JSON.stringify({
      title: '[VG-002] CI baseline',
      labels: ['risk:high'],
      checksPassed: true,
      reviewApproved: true,
    });
    const result = run('automerge', blocked);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('eligible=false');
    expect(result.output).toMatch(/risk:high/);
  });
});
