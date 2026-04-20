import { promises as fs } from 'node:fs';
import { z } from 'zod';
import {
  CATEGORIES,
  DIFFICULTIES,
  type EvalQuestion,
  type QuestionCategory,
  type QuestionDifficulty,
  type QuestionFile,
  type RunnerOptions,
  type RunnerPaths,
} from './types.js';

const countRangeSchema = z
  .object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    message: 'min must be <= max',
  });

const expectedSchema = z
  .object({
    node_count: countRangeSchema.refine((range) => range.min >= 1, {
      message: 'node_count.min must be >= 1',
    }),
    edge_count: countRangeSchema,
    required_concepts: z.array(z.string().min(1)),
    must_have_branch: z.boolean().optional(),
    must_have_loop: z.boolean().optional(),
  })
  .strict();

const rubricWeightsSchema = z
  .object({
    structure: z.number().min(0).optional(),
    labels: z.number().min(0).optional(),
    layout: z.number().min(0).optional(),
    readability: z.number().min(0).optional(),
    intent_fit: z.number().min(0).optional(),
  })
  .strict();

const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z]+-[a-z0-9-]+-[0-9]{2}$/),
    category: z.enum(CATEGORIES),
    difficulty: z.enum(DIFFICULTIES),
    prompt: z.string().min(10),
    expected: expectedSchema,
    rubric_weights: rubricWeightsSchema.optional(),
    notes: z.string().optional(),
  })
  .strict();

const questionFileSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.string(),
    questions: z.array(questionSchema),
  })
  .strict();

export async function readJsonFile(path: string): Promise<unknown> {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

export async function loadQuestionFile(paths: RunnerPaths): Promise<{
  questionFile: QuestionFile;
  jsonSchema: unknown;
  rubric: string;
}> {
  const [questionsRaw, jsonSchema, rubric] = await Promise.all([
    readJsonFile(paths.questionsPath),
    readJsonFile(paths.questionSchemaPath),
    fs.readFile(paths.rubricPath, 'utf8'),
  ]);
  const parsed = questionFileSchema.parse(questionsRaw);
  return {
    questionFile: parsed,
    jsonSchema,
    rubric,
  };
}

export function selectQuestions(
  questions: readonly EvalQuestion[],
  options: Pick<RunnerOptions, 'id' | 'category' | 'difficulty'>,
): EvalQuestion[] {
  return questions.filter((question) => {
    if (options.id !== undefined && question.id !== options.id) {
      return false;
    }
    if (
      options.category !== undefined &&
      question.category !== options.category
    ) {
      return false;
    }
    if (
      options.difficulty !== undefined &&
      question.difficulty !== options.difficulty
    ) {
      return false;
    }
    return true;
  });
}

export function parseCategory(value: string): QuestionCategory {
  const parsed = z.enum(CATEGORIES).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Unknown category: ${value}`);
  }
  return parsed.data;
}

export function parseDifficulty(value: string): QuestionDifficulty {
  const parsed = z.enum(DIFFICULTIES).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Unknown difficulty: ${value}`);
  }
  return parsed.data;
}
