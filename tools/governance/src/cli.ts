/* eslint-disable no-console -- this module is a CLI; its output is the product. */
import {
  type AutoMergeResult,
  type GovernanceResult,
  type PullRequestFacts,
  evaluateAutoMerge,
  validateGovernance,
} from './pull-request';

/**
 * CI entry point for the governance checks.
 *
 * Usage:
 *   governance validate   < pr.json   # title and label hygiene
 *   governance automerge  < pr.json   # auto-merge eligibility
 *
 * The pull request facts arrive on stdin as JSON, produced by `gh pr view`.
 * `validate` exits non-zero on violation. `automerge` always exits zero and
 * prints `eligible=true|false`, so the workflow can branch on the result
 * without treating ineligibility as a failure.
 */
export type Mode = 'validate' | 'automerge';

export function parseFacts(raw: string): PullRequestFacts {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected a JSON object describing the pull request.');
  }

  const input = parsed as Record<string, unknown>;
  return {
    title: asString(input.title, 'title'),
    labels: asLabels(input.labels),
    isDraft: input.isDraft === true,
    checksPassed: input.checksPassed === true,
    reviewApproved: input.reviewApproved === true,
    changesRequested: input.changesRequested === true,
  };
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Field "${field}" must be a string.`);
  }
  return value;
}

/** Accepts both `["risk:low"]` and gh's `[{"name":"risk:low"}]` shapes. */
function asLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object' && entry !== null) {
        const name = (entry as Record<string, unknown>).name;
        if (typeof name === 'string') return name;
      }
      return null;
    })
    .filter((name): name is string => name !== null);
}

export function renderValidate(result: GovernanceResult): string {
  if (result.compliant) {
    return 'Governance check passed.';
  }
  return ['Governance check failed:', ...result.violations.map((v) => `  - ${v}`)].join('\n');
}

export function renderAutoMerge(result: AutoMergeResult): string {
  if (result.eligible) {
    return 'eligible=true\nAuto-merge policy satisfied.';
  }
  return [
    'eligible=false',
    'Auto-merge blocked by:',
    ...result.blockers.map((b) => `  - ${b}`),
  ].join('\n');
}

export function run(mode: Mode, raw: string): { output: string; exitCode: number } {
  const facts = parseFacts(raw);

  if (mode === 'validate') {
    const result = validateGovernance(facts);
    return { output: renderValidate(result), exitCode: result.compliant ? 0 : 1 };
  }

  return { output: renderAutoMerge(evaluateAutoMerge(facts)), exitCode: 0 };
}

function isMode(value: string | undefined): value is Mode {
  return value === 'validate' || value === 'automerge';
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!isMode(mode)) {
    console.error('Usage: governance <validate|automerge> < pr.json');
    process.exitCode = 2;
    return;
  }

  const { output, exitCode } = run(mode, await readStdin());
  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }
  process.exitCode = exitCode;
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
