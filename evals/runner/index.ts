#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { writeSummary } from './aggregate.js';
import { runQuestionSample } from './pipeline.js';
import { createRunId, resolveRunnerPaths } from './paths.js';
import {
  loadQuestionFile,
  parseCategory,
  parseDifficulty,
  selectQuestions,
} from './questions.js';
import type { EvalQuestion, RunnerOptions } from './types.js';

const program = new Command();

program
  .name('drawcast-evals')
  .description('Run Drawcast E2E eval samples against the golden set.')
  .option(
    '--n <number>',
    'samples per question (default 1; use --n 3 for baseline snapshots)',
    parsePositiveInteger,
    1,
  )
  .option('--id <id>', 'run only one question id')
  .option('--category <category>', 'filter by question category', parseCategory)
  .option('--difficulty <difficulty>', 'filter by difficulty', parseDifficulty)
  .option('--dry-run', 'validate input files without external calls', false)
  .option('--skip-rubric', 'skip Codex rubric scoring', false)
  .option(
    '--concurrency <number>',
    'number of samples to execute in parallel',
    parsePositiveInteger,
    1,
  );

async function main(): Promise<void> {
  program.parse(stripPnpmSeparator(process.argv));
  const options = program.opts<RunnerOptions>();
  const paths = resolveRunnerPaths();
  const { questionFile, jsonSchema, rubric } = await loadQuestionFile(paths);
  const selected = selectQuestions(questionFile.questions, options);

  if (selected.length === 0) {
    throw new Error('No questions matched the provided filters.');
  }

  if (options.dryRun) {
    process.stdout.write(
      [
        'Drawcast eval dry run OK',
        `questions_file=${paths.questionsPath}`,
        `question_schema_file=${paths.questionSchemaPath}`,
        `rubric_file=${paths.rubricPath}`,
        `schema_loaded=${jsonSchema !== undefined}`,
        `rubric_bytes=${Buffer.byteLength(rubric, 'utf8')}`,
        `selected_questions=${selected.length}`,
        `samples_per_question=${options.n}`,
      ].join('\n') + '\n',
    );
    return;
  }

  const runId = createRunId();
  const runDir = path.join(paths.resultsDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  const tasks = buildTasks(selected, options.n);
  const results = await runLimited(tasks, options.concurrency, async (task) => {
    process.stderr.write(
      `[drawcast-evals] ${task.question.id} sample-${task.sample} start\n`,
    );
    const result = await runQuestionSample({
      question: task.question,
      sample: task.sample,
      context: {
        paths,
        runDir,
        skipRubric: options.skipRubric,
      },
    });
    const status = result.failure === undefined ? 'done' : result.failure.reason;
    process.stderr.write(
      `[drawcast-evals] ${task.question.id} sample-${task.sample} ${status}\n`,
    );
    return result;
  });

  const summary = await writeSummary({
    runId,
    runDir,
    questions: selected,
    results,
  });

  process.stdout.write(
    [
      `run_id=${summary.run_id}`,
      `run_dir=${runDir}`,
      `total_runs=${summary.total_runs}`,
      `scored_runs=${summary.scored_runs}`,
      `pass_rate=${summary.pass_rate}`,
      `failures=${summary.failures.length}`,
    ].join('\n') + '\n',
  );
}

function stripPnpmSeparator(argv: string[]): string[] {
  return argv.filter((arg, index) => index < 2 || arg !== '--');
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('Expected a positive integer.');
  }
  return parsed;
}

function buildTasks(
  questions: readonly EvalQuestion[],
  samplesPerQuestion: number,
): Array<{ question: EvalQuestion; sample: number }> {
  const tasks: Array<{ question: EvalQuestion; sample: number }> = [];
  for (const question of questions) {
    for (let sample = 1; sample <= samplesPerQuestion; sample += 1) {
      tasks.push({ question, sample });
    }
  }
  return tasks;
}

async function runLimited<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  worker: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input === undefined) {
        return;
      }
      results[index] = await worker(input);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[drawcast-evals] fatal: ${message}\n`);
  process.exitCode = 1;
});
