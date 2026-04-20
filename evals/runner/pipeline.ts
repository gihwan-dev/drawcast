import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildClaudePrompt, ClaudeRunError, runClaudeForQuestion } from './claude-client.js';
import { calculateMetrics } from './metrics.js';
import { writeMcpConfig } from './mcp-server.js';
import { renderSceneToPng } from './render.js';
import { RubricRunError, scoreWithRubric } from './rubric.js';
import { sampleStem } from './paths.js';
import type {
  EvalQuestion,
  RunnerPaths,
  SampleResult,
  ScoreArtifact,
} from './types.js';

export interface PipelineContext {
  paths: RunnerPaths;
  runDir: string;
  skipRubric: boolean;
}

export async function runQuestionSample(options: {
  question: EvalQuestion;
  sample: number;
  context: PipelineContext;
}): Promise<SampleResult> {
  const stem = sampleStem(options.question.id, options.sample);
  const scenePath = path.join(options.context.runDir, `${stem}.scene.json`);
  const pngPath = path.join(options.context.runDir, `${stem}.png`);
  const scorePath = path.join(options.context.runDir, `${stem}.score.json`);
  const tracePath = path.join(options.context.runDir, `${stem}.trace.json`);
  const baseResult: SampleResult = {
    question: options.question,
    sample: options.sample,
    scenePath,
    pngPath,
    scorePath,
    tracePath,
  };

  try {
    await fs.mkdir(options.context.runDir, { recursive: true });
    const mcpConfigPath = await writeMcpConfig({
      repoRoot: options.context.paths.repoRoot,
      runDir: options.context.runDir,
      questionId: options.question.id,
      sample: options.sample,
    });
    const claude = await runClaudeForQuestion({
      prompt: buildClaudePrompt(options.question.prompt),
      mcpConfigPath,
    });

    await writeJson(scenePath, claude.scene);
    await writeJson(tracePath, claude.trace);
    baseResult.latencyMs = claude.trace.latency_ms;

    const metrics = calculateMetrics(claude.scene, options.question);
    let rendered = true;
    try {
      await renderSceneToPng(claude.scene, pngPath);
    } catch (error) {
      rendered = false;
      const score: ScoreArtifact = {
        question_id: options.question.id,
        sample: options.sample,
        rendered,
        metrics,
        verdict: 'fail',
        failure_reason: `render_failed: ${messageFromError(error)}`,
      };
      await writeJson(scorePath, score);
      return {
        ...baseResult,
        score,
        failure: {
          id: options.question.id,
          sample: options.sample,
          reason: 'render_failed',
        },
      };
    }

    if (options.context.skipRubric) {
      const score: ScoreArtifact = {
        question_id: options.question.id,
        sample: options.sample,
        rendered,
        metrics,
        rubric_skipped: true,
        verdict: 'not_scored',
      };
      await writeJson(scorePath, score);
      return { ...baseResult, score };
    }

    try {
      const rubric = await scoreWithRubric({
        rubricPath: options.context.paths.rubricPath,
        question: options.question,
        pngPath,
      });
      const score: ScoreArtifact = {
        question_id: options.question.id,
        sample: options.sample,
        rendered,
        metrics,
        rubric,
        total: rubric.total,
        verdict: rubric.verdict,
      };
      await writeJson(scorePath, score);
      return { ...baseResult, score };
    } catch (error) {
      const reason =
        error instanceof RubricRunError ? 'rubric_parse_failed' : 'rubric_failed';
      const score: ScoreArtifact = {
        question_id: options.question.id,
        sample: options.sample,
        rendered,
        metrics,
        verdict: 'fail',
        failure_reason: `${reason}: ${messageFromError(error)}`,
      };
      await writeJson(scorePath, score);
      return {
        ...baseResult,
        score,
        failure: {
          id: options.question.id,
          sample: options.sample,
          reason,
        },
      };
    }
  } catch (error) {
    const reason = error instanceof ClaudeRunError ? error.reason : 'pipeline_error';
    if (error instanceof ClaudeRunError && error.trace !== undefined) {
      await writeJson(tracePath, error.trace);
      baseResult.latencyMs = error.trace.latency_ms;
    }
    const score: ScoreArtifact = {
      question_id: options.question.id,
      sample: options.sample,
      rendered: false,
      verdict: 'fail',
      failure_reason: `${reason}: ${messageFromError(error)}`,
    };
    await writeJson(scorePath, score);
    return {
      ...baseResult,
      score,
      failure: {
        id: options.question.id,
        sample: options.sample,
        reason,
      },
    };
  }
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
