import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { RunnerPaths } from './types.js';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export function resolveRunnerPaths(): RunnerPaths {
  const evalsDir = findEvalsDir(dirname);
  const repoRoot = path.resolve(evalsDir, '..');
  return {
    repoRoot,
    evalsDir,
    resultsDir: path.join(evalsDir, 'results'),
    questionsPath: path.join(evalsDir, 'golden-set', 'questions.json'),
    questionSchemaPath: path.join(
      evalsDir,
      'golden-set',
      'schemas',
      'question.schema.json',
    ),
    rubricPath: path.join(evalsDir, 'rubrics', 'default.md'),
  };
}

function findEvalsDir(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(path.join(current, 'golden-set', 'questions.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Unable to locate evals/golden-set/questions.json');
    }
    current = parent;
  }
}

export function createRunId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

export function sampleStem(questionId: string, sample: number): string {
  return `${questionId}.sample-${sample}`;
}
