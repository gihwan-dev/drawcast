import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  EvalQuestion,
  RubricAxis,
  RubricResult,
  SampleResult,
  ScoreArtifact,
} from './types.js';

const RUBRIC_AXES: RubricAxis[] = [
  'structure',
  'labels',
  'layout',
  'readability',
  'intent_fit',
];

interface SummaryBucket {
  pass_rate: number;
  n: number;
}

interface AxisStats {
  mean: number;
  std: number;
}

export interface SummaryJson {
  run_id: string;
  total_questions: number;
  total_runs: number;
  scored_runs: number;
  pass_rate: number;
  by_axis: Record<RubricAxis, AxisStats>;
  by_category: Record<string, SummaryBucket>;
  by_difficulty: Record<string, SummaryBucket>;
  cost_usd: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  failures: Array<{ id: string; sample: number; reason: string }>;
}

export async function writeSummary(options: {
  runId: string;
  runDir: string;
  questions: readonly EvalQuestion[];
  results: readonly SampleResult[];
}): Promise<SummaryJson> {
  const scored = options.results.filter(hasRubricScore);
  const failures = options.results
    .map((result) => result.failure)
    .filter((failure): failure is { id: string; sample: number; reason: string } =>
      failure !== undefined,
    );
  const summary: SummaryJson = {
    run_id: options.runId,
    total_questions: options.questions.length,
    total_runs: options.results.length,
    scored_runs: scored.length,
    pass_rate: rate(scored.filter((result) => result.score.rubric.verdict === 'pass').length, scored.length),
    by_axis: axisStats(scored.map((result) => result.score.rubric)),
    by_category: bucketBy(scored, (result) => result.question.category),
    by_difficulty: bucketBy(scored, (result) => result.question.difficulty),
    cost_usd: 0,
    latency_p50_ms: percentile(
      options.results
        .map((result) => result.latencyMs)
        .filter((value): value is number => typeof value === 'number'),
      0.5,
    ),
    latency_p95_ms: percentile(
      options.results
        .map((result) => result.latencyMs)
        .filter((value): value is number => typeof value === 'number'),
      0.95,
    ),
    failures,
  };

  await fs.writeFile(
    path.join(options.runDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(options.runDir, 'summary.md'),
    renderSummaryMarkdown(summary),
    'utf8',
  );
  return summary;
}

function hasRubricScore(
  result: SampleResult,
): result is SampleResult & { score: ScoreArtifact & { rubric: RubricResult } } {
  return result.score?.rubric !== undefined;
}

function axisStats(scores: readonly RubricResult[]): Record<RubricAxis, AxisStats> {
  const stats = {} as Record<RubricAxis, AxisStats>;
  for (const axis of RUBRIC_AXES) {
    stats[axis] = meanStd(scores.map((score) => score[axis]));
  }
  return stats;
}

function bucketBy(
  scored: ReadonlyArray<SampleResult & { score: ScoreArtifact & { rubric: RubricResult } }>,
  keyFor: (result: SampleResult) => string,
): Record<string, SummaryBucket> {
  const buckets = new Map<string, Array<SampleResult & { score: ScoreArtifact & { rubric: RubricResult } }>>();
  for (const result of scored) {
    const key = keyFor(result);
    const list = buckets.get(key) ?? [];
    list.push(result);
    buckets.set(key, list);
  }
  const output: Record<string, SummaryBucket> = {};
  for (const [key, values] of buckets) {
    output[key] = {
      pass_rate: rate(
        values.filter((result) => result.score.rubric.verdict === 'pass').length,
        values.length,
      ),
      n: values.length,
    };
  }
  return output;
}

function meanStd(values: readonly number[]): AxisStats {
  if (values.length === 0) {
    return { mean: 0, std: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    mean: round(mean),
    std: round(Math.sqrt(variance)),
  };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : round(count / total);
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function renderSummaryMarkdown(summary: SummaryJson): string {
  const axisRows = RUBRIC_AXES.map((axis) => {
    const stats = summary.by_axis[axis];
    return `| ${axis} | ${stats.mean} | ${stats.std} |`;
  }).join('\n');
  const failureRows =
    summary.failures.length === 0
      ? 'No failures.'
      : summary.failures
          .map(
            (failure) =>
              `- ${failure.id} sample-${failure.sample}: ${failure.reason}`,
          )
          .join('\n');

  return `# Drawcast Eval Summary

- run_id: ${summary.run_id}
- questions: ${summary.total_questions}
- total_runs: ${summary.total_runs}
- scored_runs: ${summary.scored_runs}
- pass_rate: ${summary.pass_rate}
- latency_p50_ms: ${summary.latency_p50_ms ?? 'n/a'}
- latency_p95_ms: ${summary.latency_p95_ms ?? 'n/a'}

## Axis Means

| Axis | Mean | Std |
|---|---:|---:|
${axisRows}

## Failures

${failureRows}
`;
}
