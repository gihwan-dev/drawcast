export const CATEGORIES = [
  'flowchart',
  'architecture',
  'sequence',
  'erd',
  'state',
  'mind',
  'org',
  'network',
] as const;

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type QuestionCategory = (typeof CATEGORIES)[number];
export type QuestionDifficulty = (typeof DIFFICULTIES)[number];

export interface CountRange {
  min: number;
  max: number;
}

export interface ExpectedShape {
  node_count: CountRange;
  edge_count: CountRange;
  required_concepts: string[];
  must_have_branch?: boolean | undefined;
  must_have_loop?: boolean | undefined;
}

export type RubricAxis =
  | 'structure'
  | 'labels'
  | 'layout'
  | 'readability'
  | 'intent_fit';

export type RubricWeights = Partial<Record<RubricAxis, number | undefined>>;

export interface EvalQuestion {
  id: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  prompt: string;
  expected: ExpectedShape;
  rubric_weights?: RubricWeights | undefined;
  notes?: string | undefined;
}

export interface QuestionFile {
  $schema?: string | undefined;
  version: string;
  questions: EvalQuestion[];
}

export interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  points?: Array<[number, number]>;
  startBinding?: { elementId?: string | null } | null;
  endBinding?: { elementId?: string | null } | null;
  [key: string]: unknown;
}

export interface ExcalidrawScene {
  type: string;
  version?: number;
  source?: string;
  elements: ExcalidrawElement[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MetricsResult {
  node_count: number;
  edge_count: number;
  node_count_fit: 0 | 1;
  edge_count_fit: 0 | 1;
  concept_coverage: number;
  overlap_pairs: number;
  has_branch?: boolean;
  has_loop?: boolean;
}

export interface RubricScores {
  structure: number;
  labels: number;
  layout: number;
  readability: number;
  intent_fit: number;
}

export interface RubricResult extends RubricScores {
  major_issues: string[];
  minor_issues: string[];
  notes: string;
  total: number;
  verdict: 'pass' | 'borderline' | 'fail';
}

export interface ToolCallTrace {
  id: string;
  name: string;
  input?: unknown;
}

export interface TokenUsageTrace {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ClaudeTrace {
  prompt: string;
  command: string;
  args: string[];
  started_at: string;
  completed_at: string;
  latency_ms: number;
  exit_code: number | null;
  timed_out: boolean;
  tool_calls: ToolCallTrace[];
  usage: TokenUsageTrace;
  stderr?: string;
}

export interface ScoreArtifact {
  question_id: string;
  sample: number;
  rendered: boolean;
  metrics?: MetricsResult;
  rubric?: RubricResult;
  rubric_skipped?: boolean;
  total?: number;
  verdict: 'pass' | 'borderline' | 'fail' | 'not_scored';
  failure_reason?: string;
}

export interface SampleResult {
  question: EvalQuestion;
  sample: number;
  scenePath: string;
  pngPath: string;
  scorePath: string;
  tracePath: string;
  latencyMs?: number;
  score?: ScoreArtifact;
  failure?: {
    id: string;
    sample: number;
    reason: string;
  };
}

export interface RunnerPaths {
  repoRoot: string;
  evalsDir: string;
  resultsDir: string;
  questionsPath: string;
  questionSchemaPath: string;
  rubricPath: string;
}

export interface RunnerOptions {
  n: number;
  id?: string;
  category?: QuestionCategory;
  difficulty?: QuestionDifficulty;
  dryRun: boolean;
  skipRubric: boolean;
  concurrency: number;
}
