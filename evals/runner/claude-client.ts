import { execa, type ExecaError } from 'execa';
import type {
  ClaudeTrace,
  EvalQuestion,
  ExcalidrawScene,
  QuestionCategory,
  TokenUsageTrace,
  ToolCallTrace,
} from './types.js';

const CLAUDE_TIMEOUT_MS = 600_000;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class ClaudeRunError extends Error {
  readonly reason: string;
  readonly trace?: ClaudeTrace;

  constructor(message: string, reason: string, trace?: ClaudeTrace) {
    super(message);
    this.name = 'ClaudeRunError';
    this.reason = reason;
    if (trace !== undefined) {
      this.trace = trace;
    }
  }
}

export interface ClaudeRunResult {
  /**
   * Scene parsed from Claude's own draw_export tool call, if it made one.
   * Optional now: the runner calls draw_export directly after Claude exits
   * (see runner/mcp-client.ts), so missing voluntary exports no longer fail
   * the attempt.
   */
  scene?: ExcalidrawScene;
  trace: ClaudeTrace;
}

interface ParsedClaudeStream {
  events: unknown[];
  toolCalls: ToolCallTrace[];
  usage: TokenUsageTrace;
  drawExportScene: ExcalidrawScene | undefined;
}

export async function runClaudeForQuestion(options: {
  prompt: string;
  mcpConfigPath: string;
  timeoutMs?: number;
}): Promise<ClaudeRunResult> {
  const args = [
    '-p',
    '--mcp-config',
    options.mcpConfigPath,
    '--output-format',
    'stream-json',
    '--verbose',
    '--allowedTools',
    'mcp__drawcast__draw_*',
  ];
  const startedAt = new Date();
  const timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS;

  let result: CommandResult;
  try {
    result = toCommandResult(
      await execa('claude', args, {
        reject: false,
        input: options.prompt,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: timeoutMs,
      }),
    );
  } catch (error) {
    const execaError = error as ExecaError;
    const completedAt = new Date();
    const trace = buildTrace({
      prompt: options.prompt,
      args,
      startedAt,
      completedAt,
      exitCode: execaError.exitCode ?? null,
      timedOut: Boolean(execaError.timedOut),
      stderr: outputToString(execaError.stderr),
      parsed: {
        events: [],
        toolCalls: [],
        usage: {},
        drawExportScene: undefined,
      },
    });
    throw new ClaudeRunError(
      execaError.timedOut
        ? `Claude timed out after ${timeoutMs}ms`
        : `Claude failed: ${execaError.shortMessage}`,
      execaError.timedOut ? 'claude_timeout' : 'claude_error',
      trace,
    );
  }

  const completedAt = new Date();
  const parsed = parseClaudeStream(result.stdout);
  const trace = buildTrace({
    prompt: options.prompt,
    args,
    startedAt,
    completedAt,
    exitCode: result.exitCode,
    timedOut: false,
    stderr: result.stderr,
    parsed,
  });

  if (result.exitCode !== 0) {
    throw new ClaudeRunError(
      `Claude exited with code ${result.exitCode}`,
      'claude_error',
      trace,
    );
  }

  const out: ClaudeRunResult = { trace };
  if (parsed.drawExportScene !== undefined) {
    out.scene = parsed.drawExportScene;
  }
  return out;
}

function toCommandResult(result: unknown): CommandResult {
  const record =
    result !== null && typeof result === 'object'
      ? (result as Record<string, unknown>)
      : {};
  const exitCodeValue = record.exitCode;
  return {
    stdout: outputToString(record.stdout) ?? '',
    stderr: outputToString(record.stderr) ?? '',
    exitCode: typeof exitCodeValue === 'number' ? exitCodeValue : null,
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

const CATEGORY_SHAPE_HINTS: Record<QuestionCategory, string> = {
  flowchart: '플로우차트: 시작·판단·처리·종료 노드를 선 방향(보통 위→아래)으로 배치, 분기·루프는 화살표로 명시.',
  architecture: '아키텍처 다이어그램: 레이어/컴포넌트를 박스와 그룹으로 묶고, 데이터 흐름은 방향 있는 엣지로.',
  sequence: '시퀀스 다이어그램: 참여자(actor/service)를 상단 가로 축에 나열하고, 각 참여자 아래로 생명선을 세로로 내린 뒤 시간 순서대로 참여자 간 메시지를 가로 화살표로 그린다. 플로우차트 형태(위→아래 단일 흐름)로 그리지 말 것.',
  erd: 'ERD: 엔티티를 사각형으로, 관계는 엣지 라벨로 카디널리티(1, N, 1..N 등) 명시.',
  state: '상태 다이어그램: 상태 노드와 전이(이벤트/조건) 엣지, 시작/종료 상태 표기.',
  mind: '마인드맵: 중앙 노드에서 방사형 가지, 깊이 2~3단계.',
  org: '조직도: 최상위에서 하위로 트리 구조, 팀·역할 단위.',
  network: '네트워크 다이어그램: 장비·영역을 묶고 물리/논리 링크를 엣지로.',
};

function buildCountHint(range: { min: number; max: number } | undefined, label: string): string | undefined {
  if (!range) return undefined;
  if (range.min === range.max) return `${label} 약 ${range.min}개`;
  return `${label} ${range.min}~${range.max}개`;
}

export function buildClaudePrompt(question: EvalQuestion): string {
  const shapeHint = CATEGORY_SHAPE_HINTS[question.category];
  const countHints = [
    buildCountHint(question.expected.node_count, '노드'),
    buildCountHint(question.expected.edge_count, '엣지'),
  ].filter((value): value is string => value !== undefined);
  const branchHint = question.expected.must_have_branch ? '성공/실패(또는 조건) 분기 경로를 반드시 포함.' : undefined;
  const loopHint = question.expected.must_have_loop ? '반복(루프) 경로를 반드시 포함.' : undefined;
  const conceptHint =
    question.expected.required_concepts.length > 0
      ? `필수 개념: ${question.expected.required_concepts.join(', ')}.`
      : undefined;

  const constraintLines = [
    shapeHint,
    countHints.length > 0 ? `구조 범위: ${countHints.join(', ')}.` : undefined,
    branchHint,
    loopHint,
    conceptHint,
  ].filter((line): line is string => line !== undefined);

  const constraintBlock = constraintLines.length > 0 ? `\n\n제약:\n- ${constraintLines.join('\n- ')}` : '';

  return `${question.prompt}${constraintBlock}

drawcast MCP 도구(mcp__drawcast__draw_upsert_box, mcp__drawcast__draw_upsert_edge 등)로 다이어그램을 완성한 뒤 응답을 종료해라. 완성된 씬은 평가 러너가 MCP에서 직접 수집하므로 draw_export를 따로 호출할 필요는 없다. 설명·요약·확인 메시지는 덧붙이지 말 것.

노드·엣지 라벨은 사용자 질문에 쓰인 언어와 어휘를 그대로 따른다. 질문이 한국어면 라벨도 한국어로 적고, 사용자가 명시한 용어(예: "로드밸런서", "캐시", "복제본")는 영어로 번역하지 말고 그대로 사용한다. 고유명사·약어(CDN, Redis, Kafka 등)는 원문 표기 유지.`;
}

function buildTrace(options: {
  prompt: string;
  args: string[];
  startedAt: Date;
  completedAt: Date;
  exitCode: number | null;
  timedOut: boolean;
  stderr: string | undefined;
  parsed: ParsedClaudeStream;
}): ClaudeTrace {
  const trace: ClaudeTrace = {
    prompt: options.prompt,
    command: 'claude',
    args: options.args,
    started_at: options.startedAt.toISOString(),
    completed_at: options.completedAt.toISOString(),
    latency_ms: options.completedAt.getTime() - options.startedAt.getTime(),
    exit_code: options.exitCode,
    timed_out: options.timedOut,
    tool_calls: options.parsed.toolCalls,
    usage: options.parsed.usage,
  };
  if (options.stderr !== undefined && options.stderr.length > 0) {
    trace.stderr = options.stderr;
  }
  return trace;
}

function parseClaudeStream(stdout: string): ParsedClaudeStream {
  const events: unknown[] = [];
  const toolCalls: ToolCallTrace[] = [];
  const toolNamesById = new Map<string, string>();
  const usage: TokenUsageTrace = {};
  let drawExportScene: ExcalidrawScene | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    events.push(event);
    mergeUsage(usage, event);

    for (const value of walkObjects(event)) {
      const record = asRecord(value);
      if (record === undefined) {
        continue;
      }
      if (record.type === 'tool_use') {
        const id = asString(record.id);
        const name = asString(record.name);
        if (id !== undefined && name !== undefined) {
          toolNamesById.set(id, name);
          toolCalls.push({ id, name, input: record.input });
        }
      }
      if (record.type === 'tool_result') {
        const toolUseId = asString(record.tool_use_id);
        if (toolUseId === undefined) {
          continue;
        }
        const toolName = toolNamesById.get(toolUseId);
        if (toolName !== 'mcp__drawcast__draw_export') {
          continue;
        }
        const text = extractText(record.content);
        const scene = parseSceneFromToolText(text);
        if (scene !== undefined) {
          drawExportScene = scene;
        }
      }
    }
  }

  return { events, toolCalls, usage, drawExportScene };
}

function* walkObjects(value: unknown): Generator<unknown> {
  if (value === null || typeof value !== 'object') {
    return;
  }
  yield value;
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walkObjects(item);
    }
    return;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    yield* walkObjects(nested);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function mergeUsage(target: TokenUsageTrace, event: unknown): void {
  for (const value of walkObjects(event)) {
    const record = asRecord(value);
    const usage = asRecord(record?.usage);
    if (usage === undefined) {
      continue;
    }
    for (const key of [
      'input_tokens',
      'output_tokens',
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
    ] as const) {
      const amount = usage[key];
      if (typeof amount === 'number') {
        target[key] = (target[key] ?? 0) + amount;
      }
    }
  }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).join('\n');
  }
  const record = asRecord(value);
  if (record === undefined) {
    return '';
  }
  if (typeof record.text === 'string') {
    return record.text;
  }
  if (record.content !== undefined) {
    return extractText(record.content);
  }
  return '';
}

function parseSceneFromToolText(text: string): ExcalidrawScene | undefined {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return undefined;
  }
  const jsonText = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const record = asRecord(parsed);
    if (
      record !== undefined &&
      typeof record.type === 'string' &&
      Array.isArray(record.elements)
    ) {
      return parsed as ExcalidrawScene;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
