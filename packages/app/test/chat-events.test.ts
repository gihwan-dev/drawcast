// Zod-validated chat-event parser tests.
//
// The `claude -p --output-format stream-json` schema has shifted field names
// and added variants across CLI releases, so the parser MUST be drift-
// tolerant: never throw, always produce something the store can read.
// These tests lock the behaviour of every branch that reducer relies on.
//
// Fixture lives in `test/fixtures/chat-events.ndjson` — a recorded
// cross-section of a real session (init + user + assistant text + tool
// use/result + thinking + rate limit + result success/error + unknown
// variant). Adding a CLI version should be a fixture edit + one assertion.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseChatEvent,
  parseChatEventLine,
} from '../src/services/chat-events.js';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'chat-events.ndjson',
);

describe('parseChatEvent — known variants', () => {
  it('accepts system/init with session metadata', () => {
    const { event, issues } = parseChatEvent({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'claude-opus-4-7',
      apiKeySource: 'none',
      mcp_servers: [{ name: 'drawcast', status: 'connected' }],
      tools: ['draw_upsert_box'],
      permissionMode: 'default',
    });
    expect(issues).toEqual([]);
    expect(event.type).toBe('system');
    if (event.type === 'system') {
      expect(event.subtype).toBe('init');
      expect(event.session_id).toBe('s1');
    }
  });

  it('accepts other system subtypes via the permissive system schema', () => {
    const { event, issues } = parseChatEvent({
      type: 'system',
      subtype: 'hook_fired',
      hook: 'UserPromptSubmit',
    });
    expect(issues).toEqual([]);
    expect(event.type).toBe('system');
  });

  it('accepts assistant events with text + tool_use + thinking blocks', () => {
    const { event, issues } = parseChatEvent({
      type: 'assistant',
      message: {
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'thinking', thinking: 'let me think' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'draw_upsert_box',
            input: { id: 'start', x: 0, y: 0 },
          },
        ],
      },
      session_id: 's1',
      uuid: 'u1',
    });
    expect(issues).toEqual([]);
    expect(event.type).toBe('assistant');
  });

  it('accepts user replay events', () => {
    const { event, issues } = parseChatEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'draw something' }],
      },
    });
    expect(issues).toEqual([]);
    expect(event.type).toBe('user');
  });

  it('accepts result events with usage + cost', () => {
    const { event, issues } = parseChatEvent({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(issues).toEqual([]);
    expect(event.type).toBe('result');
  });

  it('accepts rate_limit_event with nested info', () => {
    const { event, issues } = parseChatEvent({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', isUsingOverage: false },
    });
    expect(issues).toEqual([]);
    expect(event.type).toBe('rate_limit_event');
  });
});

describe('parseChatEvent — pass-through for unknown variants', () => {
  it('keeps unknown `type` values raw and reports no issues', () => {
    const raw = { type: 'future_variant', some_field: 42 };
    const { event, issues } = parseChatEvent(raw);
    expect(issues).toEqual([]);
    expect(event.type).toBe('future_variant');
    // Pass-through should preserve untyped extras.
    expect((event as { some_field?: number }).some_field).toBe(42);
  });

  it('preserves unknown fields on known types (.passthrough)', () => {
    const { event, issues } = parseChatEvent({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      newly_added_field: 'cli-next',
    });
    expect(issues).toEqual([]);
    expect(
      (event as { newly_added_field?: string }).newly_added_field,
    ).toBe('cli-next');
  });
});

describe('parseChatEvent — validation failures fall back without throwing', () => {
  it('returns raw event + issues when a known type fails strict validation', () => {
    // `assistant` requires message.role === 'assistant'; feeding the wrong
    // role should surface as issues without throwing.
    const raw = {
      type: 'assistant',
      message: { role: 'user', content: [] },
    };
    const { event, issues } = parseChatEvent(raw);
    expect(event.type).toBe('assistant');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('returns unknown envelope when top-level `type` is missing', () => {
    const { event, issues } = parseChatEvent({ no_type: true });
    expect(event.type).toBe('unknown');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('returns unknown envelope for non-object payloads', () => {
    const cases: unknown[] = [null, 42, 'text', [], undefined];
    for (const c of cases) {
      const { event, issues } = parseChatEvent(c);
      expect(event.type).toBe('unknown');
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it('falls back to system pass-through when subtype is missing but type is system', () => {
    const { event, issues } = parseChatEvent({ type: 'system' });
    // Both system variants require `subtype`; neither succeeds.
    expect(event.type).toBe('system');
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('parseChatEventLine', () => {
  it('skips blank lines', () => {
    expect(parseChatEventLine('')).toBeNull();
    expect(parseChatEventLine('   \t  ')).toBeNull();
  });

  it('surfaces JSON parse errors as issues, not throws', () => {
    const result = parseChatEventLine('{not json');
    expect(result).not.toBeNull();
    expect(result!.event.type).toBe('unknown');
    expect(result!.issues.some((m) => m.includes('JSON parse'))).toBe(true);
  });

  it('routes valid lines through parseChatEvent', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc',
    });
    const result = parseChatEventLine(line);
    expect(result).not.toBeNull();
    expect(result!.issues).toEqual([]);
    expect(result!.event.type).toBe('system');
  });
});

describe('parseChatEventLine — NDJSON fixture', () => {
  const lines = readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  it('parses every fixture line without producing issues', () => {
    for (const line of lines) {
      const result = parseChatEventLine(line);
      expect(result, `line should parse: ${line.slice(0, 80)}`).not.toBeNull();
      expect(
        result!.issues,
        `no drift issues for line: ${line.slice(0, 80)}`,
      ).toEqual([]);
    }
  });

  it('the fixture covers every known top-level event variant + one unknown', () => {
    const types = new Set<string>();
    for (const line of lines) {
      const result = parseChatEventLine(line);
      if (result) types.add(result.event.type);
    }
    // These are the variants the chatStore reducer branches on.
    for (const required of [
      'system',
      'user',
      'assistant',
      'result',
      'rate_limit_event',
    ]) {
      expect(types.has(required), `fixture must cover ${required}`).toBe(true);
    }
    // At least one genuinely unknown variant so the pass-through path is
    // exercised by the fixture too.
    const hasUnknown = [...types].some(
      (t) =>
        t !== 'system' &&
        t !== 'user' &&
        t !== 'assistant' &&
        t !== 'result' &&
        t !== 'rate_limit_event',
    );
    expect(hasUnknown, 'fixture must include a future/unknown variant').toBe(
      true,
    );
  });
});
