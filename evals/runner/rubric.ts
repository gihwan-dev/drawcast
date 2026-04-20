import { promises as fs } from 'node:fs';
import { execa, type ExecaError } from 'execa';
import { z } from 'zod';
import type { EvalQuestion, RubricResult, RubricScores } from './types.js';

const RUBRIC_AXES = [
  'structure',
  'labels',
  'layout',
  'readability',
  'intent_fit',
] as const;

const MAX_SCORES: RubricScores = {
  structure: 5,
  labels: 5,
  layout: 3,
  readability: 3,
  intent_fit: 5,
};

interface CommandResult {
  stdout: string;
  stderr: string;
}

const rubricResponseSchema = z
  .object({
    structure: z.number().int().min(0).max(5),
    labels: z.number().int().min(0).max(5),
    layout: z.number().int().min(0).max(3),
    readability: z.number().int().min(0).max(3),
    intent_fit: z.number().int().min(0).max(5),
    major_issues: z.array(z.string()),
    minor_issues: z.array(z.string()),
    notes: z.string(),
  })
  .strict();

export class RubricRunError extends Error {
  readonly stdout?: string;
  readonly stderr?: string;

  constructor(
    message: string,
    output?: { stdout?: string | undefined; stderr?: string | undefined },
  ) {
    super(message);
    this.name = 'RubricRunError';
    if (output?.stdout !== undefined) {
      this.stdout = output.stdout;
    }
    if (output?.stderr !== undefined) {
      this.stderr = output.stderr;
    }
  }
}

export async function scoreWithRubric(options: {
  rubricPath: string;
  question: EvalQuestion;
  pngPath: string;
}): Promise<RubricResult> {
  const rubric = await fs.readFile(options.rubricPath, 'utf8');
  const prompt = `${rubric}
---
# 이 케이스의 입력
질문: ${options.question.prompt}
첨부된 이미지(PNG)가 렌더 결과의 전부다. scene JSON은 의도적으로 주어지지 않는다 — 사람이 화면에서 보는 신호만으로 채점해라.
위 rubric대로 채점한 JSON만 출력해라.`;

  let lastOutput: { stdout?: string; stderr?: string } | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runCodexRubric({
      prompt,
      pngPath: options.pngPath,
    });
    lastOutput = { stdout: result.stdout, stderr: result.stderr };
    const parsed = parseRubricJson(result.stdout);
    if (parsed !== undefined) {
      return withTotal(parsed, options.question);
    }
  }

  throw new RubricRunError('Codex rubric response was not parseable JSON', lastOutput);
}

async function runCodexRubric(options: {
  prompt: string;
  pngPath: string;
}): Promise<CommandResult> {
  try {
    return toCommandResult(
      await execa(
        'codex',
        [
          'exec',
          '--model',
          'gpt-5.4',
          '--skip-git-repo-check',
          '--image',
          options.pngPath,
          '-',
        ],
        {
          reject: false,
          input: options.prompt,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 180_000,
        },
      ),
    );
  } catch (error) {
    const execaError = error as ExecaError;
    throw new RubricRunError(
      execaError.timedOut
        ? 'Codex rubric timed out'
        : `Codex rubric failed: ${execaError.shortMessage}`,
      {
        stdout: outputToString(execaError.stdout),
        stderr: outputToString(execaError.stderr),
      },
    );
  }
}

function toCommandResult(result: unknown): CommandResult {
  const record =
    result !== null && typeof result === 'object'
      ? (result as Record<string, unknown>)
      : {};
  return {
    stdout: outputToString(record.stdout) ?? '',
    stderr: outputToString(record.stderr) ?? '',
  };
}

function outputToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }
  if (Array.isArray(value)) {
    return value.map((item) => outputToString(item) ?? '').join('\n');
  }
  return undefined;
}

function parseRubricJson(stdout: string): z.infer<typeof rubricResponseSchema> | undefined {
  const lines = stdout.split('\n');
  for (let startLine = lines.length - 1; startLine >= 0; startLine -= 1) {
    const line = lines[startLine];
    if (line === undefined || !line.trim().startsWith('{')) continue;
    const snippet = lines.slice(startLine).join('\n').trim();
    const lastClose = snippet.lastIndexOf('}');
    if (lastClose < 0) continue;
    const candidate = snippet.slice(0, lastClose + 1);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = rubricResponseSchema.safeParse(parsed);
      if (validated.success) return validated.data;
    } catch {
      continue;
    }
  }
  return undefined;
}

function withTotal(
  scores: z.infer<typeof rubricResponseSchema>,
  question: EvalQuestion,
): RubricResult {
  let weighted = 0;
  let max = 0;
  for (const axis of RUBRIC_AXES) {
    const weight = question.rubric_weights?.[axis] ?? 1;
    weighted += weight * scores[axis];
    max += weight * MAX_SCORES[axis];
  }
  const total = max === 0 ? 0 : weighted / max;
  const anyLow = RUBRIC_AXES.some((axis) => scores[axis] <= 1);
  const verdict =
    total >= 0.7 && !anyLow ? 'pass' : total < 0.5 || anyLow ? 'fail' : 'borderline';

  return {
    ...scores,
    total: Math.round(total * 1000) / 1000,
    verdict,
  };
}
