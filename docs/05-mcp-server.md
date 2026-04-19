# 05. MCP Server

## 책임

`@drawcast/mcp-server`는 다음을 담당한다:

1. **Scene 상태 소유**. 모든 primitive의 single source of truth.
2. **MCP tool handler**. Claude CLI(또는 MCP 호환 클라이언트)가 호출하는 API.
3. **SSE 전송**. 연결된 앱·뷰어에 scene 변경 push.
4. **HTTP endpoint**. 앱이 preview 이미지 등을 서버에 보고하는 역방향 채널.
5. **Standalone CLI**. 앱 없이 단독 실행 가능 (`drawcast-mcp`).

## 전송 모드

### 모드 A: stdio

MCP 호환 클라이언트(Claude Code CLI 등)가 프로세스 직접 spawn. 단일 사용자, single-tenant.

```
drawcast-mcp --stdio
```

### 모드 B: SSE (default)

localhost에서 HTTP+SSE로 listen. 여러 클라이언트 연결 가능 (앱 + CLI 동시).

```
drawcast-mcp --sse --port 43017
# → stdout: "DRAWCAST_PORT=43017"
#           "DRAWCAST_READY=1"
```

포트 충돌 시 자동 선택 (`--port auto`):
```
drawcast-mcp --sse --port auto
# → stdout: "DRAWCAST_PORT=53924"
```

앱 sidecar 모드에서는 `auto` 사용.

## SDK 선택

TypeScript로 구현. MCP 공식 SDK 사용:

```
npm install @modelcontextprotocol/sdk
```

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
```

## Scene Store

```ts
// @drawcast/mcp-server/src/store.ts
import { Scene, Primitive, PrimitiveId, Theme, sketchyTheme } from '@drawcast/core';
import { EventEmitter } from 'node:events';

export class SceneStore extends EventEmitter {
  private primitives = new Map<PrimitiveId, Primitive>();
  private theme: Theme = sketchyTheme;
  private selectionIds = new Set<PrimitiveId>();
  private editLocks = new Set<PrimitiveId>();  // 사용자 수동 편집 잠금

  getScene(): Scene {
    return {
      primitives: new Map(this.primitives),
      theme: this.theme,
    };
  }

  upsert(primitive: Primitive): void {
    const prev = this.primitives.get(primitive.id);
    this.primitives.set(primitive.id, primitive);
    this.emit('change', { type: 'upsert', id: primitive.id, prev, next: primitive });
  }

  remove(id: PrimitiveId): boolean {
    const existed = this.primitives.delete(id);
    if (existed) this.emit('change', { type: 'remove', id });
    return existed;
  }

  clear(): void {
    this.primitives.clear();
    this.emit('change', { type: 'clear' });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.emit('change', { type: 'theme', theme });
  }

  // 앱 → 서버: 사용자 선택 상태 동기화
  setSelection(ids: PrimitiveId[]): void {
    this.selectionIds = new Set(ids);
    this.emit('selection', ids);
  }

  getSelection(): PrimitiveId[] {
    return [...this.selectionIds];
  }

  // 사용자 편집 잠금 (CLI가 건드리지 않도록)
  lock(id: PrimitiveId): void { this.editLocks.add(id); }
  unlock(id: PrimitiveId): void { this.editLocks.delete(id); }
  isLocked(id: PrimitiveId): boolean { return this.editLocks.has(id); }
}
```

`SceneStore`는 `EventEmitter`로 변경 알림을 발행한다. SSE transport는 이 이벤트를 구독해 연결된 클라이언트에 push.

## Tool Schema 전체

```
# Primitive mutation
draw_upsert_box        — LabelBox 추가/수정
draw_upsert_edge       — Connector 추가/수정
draw_upsert_sticky     — Sticky 추가/수정
draw_upsert_group      — Group 추가/수정
draw_upsert_frame      — Frame 추가/수정
draw_upsert_shape      — Line/Freedraw/Image/Embed (kind로 분기)

# Primitive 조회/삭제
draw_get_scene         — 전체 primitive 목록
draw_get_primitive     — 단일 primitive 조회
draw_remove            — primitive 삭제
draw_clear             — 전체 삭제

# Selection & Interaction
draw_get_selection     — 사용자가 Excalidraw에서 선택한 primitive ids

# Theme
draw_list_style_presets  — 현재 theme의 사용 가능 프리셋
draw_set_theme           — 테마 전환 (sketchy/clean/mono)

# Preview & Export
draw_get_preview       — Excalidraw의 PNG 렌더 요청 (앱 필요)
draw_export            — .excalidraw JSON 반환
draw_copy_to_clipboard — 앱 클립보드에 복사 요청

# Session
draw_get_session_path  — 세션 디렉토리 절대 경로
draw_list_uploads      — uploads/ 디렉토리 나열
```

총 15개. LLM context에 과부하가 되긴 하지만 각 tool 설명이 명확하면 실사용에서는 대부분 `draw_upsert_box`/`edge` 만 쓰게 된다.

## Tool 상세 정의

### `draw_upsert_box`

```ts
{
  name: 'draw_upsert_box',
  description: `
다이어그램에 박스(노드)를 추가하거나 수정합니다.
같은 id로 재호출하면 업데이트됩니다 (upsert).

id는 재참조를 위해 의미있는 이름을 권장합니다 (예: "login-step", "auth-check").
좌표(at)는 대략적으로 주세요 — 크기는 텍스트에 맞춰 자동 조정됩니다.
style은 프리셋 이름 문자열 또는 인라인 객체로 지정.

사용 가능 프리셋을 모르면 draw_list_style_presets()를 먼저 호출하세요.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '의미있는 identifier' },
      text: { type: 'string', description: '박스 안 텍스트. 생략 시 빈 도형' },
      shape: {
        type: 'string',
        enum: ['rectangle', 'ellipse', 'diamond'],
        description: '도형. 생략 시 style 프리셋의 shape 사용',
      },
      at: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2, maxItems: 2,
        description: '좌표 [x, y]',
      },
      style: {
        description: '스타일 프리셋 이름 또는 override 객체',
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              preset: { type: 'string' },
              strokeColor: { type: 'string' },
              backgroundColor: { type: 'string' },
              fillStyle: { enum: ['hachure', 'cross-hatch', 'solid', 'zigzag'] },
              strokeWidth: { type: 'number' },
              strokeStyle: { enum: ['solid', 'dashed', 'dotted'] },
              roughness: { type: 'number', enum: [0, 1, 2] },
              fontSize: { type: 'number' },
            },
          },
        ],
      },
      fit: { type: 'string', enum: ['auto', 'fixed'], default: 'auto' },
      size: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2, maxItems: 2,
        description: 'fit="fixed"일 때 사용',
      },
      rounded: { type: 'boolean', description: 'rectangle/diamond의 rounded corner' },
    },
    required: ['id', 'at'],
  },
}
```

### `draw_upsert_edge`

```ts
{
  name: 'draw_upsert_edge',
  description: `
두 박스를 잇는 화살표(엣지)를 추가하거나 수정합니다.
from/to는 박스 id를 주면 자동으로 바인딩됩니다.
좌표로 주면 자유 endpoint가 됩니다.

화살표는 자동으로 노드 경계에서 시작/끝나므로 정확한 좌표 계산 불필요.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      from: {
        description: '박스 id 또는 좌표 [x, y]',
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        ],
      },
      to: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        ],
      },
      label: { type: 'string', description: '엣지 중간 라벨' },
      routing: {
        type: 'string',
        enum: ['straight', 'elbow', 'curved'],
        default: 'straight',
        description: 'elbow는 L자 라우팅, curved는 곡선',
      },
      arrowhead: {
        type: 'object',
        properties: {
          start: {
            enum: ['arrow', 'triangle', 'bar', 'dot', 'circle', 'diamond', null],
          },
          end: {
            enum: ['arrow', 'triangle', 'bar', 'dot', 'circle', 'diamond', null],
            default: 'arrow',
          },
        },
      },
      style: { /* EdgeStyle preset or override */ },
    },
    required: ['id', 'from', 'to'],
  },
}
```

### `draw_upsert_sticky`

```ts
{
  name: 'draw_upsert_sticky',
  description: `
독립 텍스트를 추가합니다. 박스 없는 자유 텍스트 - 제목, 주석, 범례 등.
여러 줄은 \\n으로 구분.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      text: { type: 'string' },
      at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      textAlign: { enum: ['left', 'center', 'right'], default: 'left' },
      fontSize: { type: 'number' },
      fontFamily: {
        description: '1=Virgil, 2=Helvetica, 3=Cascadia, 5=Excalifont (기본)',
        enum: [1, 2, 3, 5, 6, 7, 8, 9],
      },
      width: { type: 'number', description: '지정 시 이 너비로 강제 wrap' },
    },
    required: ['id', 'text', 'at'],
  },
}
```

### `draw_upsert_group`, `draw_upsert_frame`

비슷한 패턴. `children` 배열로 child primitive id 목록을 받음.

### `draw_upsert_shape` (coverage primitives 통합)

Line/Freedraw/Image/Embed를 한 tool로 묶음:

```ts
{
  name: 'draw_upsert_shape',
  description: `
구조화되지 않은 요소를 추가합니다 (직선, 이미지, 임베드 등).
kind로 구체 타입 지정. 대부분의 경우 draw_upsert_box/edge를 먼저 고려하세요.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      kind: { enum: ['line', 'freedraw', 'image', 'embed'] },
      // kind별 추가 속성은 oneOf로...
    },
    required: ['id', 'kind'],
  },
}
```

### `draw_get_selection`

```ts
{
  name: 'draw_get_selection',
  description: `
사용자가 현재 Excalidraw 캔버스에서 선택한 primitive id 목록을 반환합니다.
사용자가 "이거" "이 노드"같이 지시 대명사를 쓸 때 먼저 호출하세요.
  `.trim(),
  inputSchema: { type: 'object', properties: {} },
}

// 응답:
{ selected_ids: ['login-step', 'auth-check'] }
```

### `draw_get_preview`

```ts
{
  name: 'draw_get_preview',
  description: `
현재 씬의 PNG 프리뷰 이미지를 반환합니다.
앱이 연결되어 있어야 동작합니다 (앱이 Excalidraw를 실제 렌더하므로).
렌더 결과를 이미지로 보고 구조적 피드백을 주려 할 때 사용.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      scale: { type: 'number', default: 1, description: '1 또는 2 (Retina)' },
      padding: { type: 'number', default: 20 },
    },
  },
}

// 응답: MCP의 image content type
{
  content: [
    {
      type: 'image',
      data: 'iVBORw0KGgo...',       // base64
      mimeType: 'image/png',
    },
  ],
}
```

### `draw_export`

```ts
{
  name: 'draw_export',
  description: `
현재 씬을 .excalidraw 파일 JSON 포맷으로 반환합니다.
파일 저장 경로를 path로 주면 그 경로에 저장하고, 없으면 문자열로 반환.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '저장 경로 (선택)' },
      format: {
        enum: ['excalidraw', 'clipboard', 'obsidian'],
        default: 'excalidraw',
      },
    },
  },
}
```

### `draw_copy_to_clipboard`

앱이 연결돼 있을 때 앱 측에서 실제 클립보드 조작. MCP 서버는 앱에 요청만 보냄.

```ts
{
  name: 'draw_copy_to_clipboard',
  description: `
현재 씬을 앱의 클립보드에 복사합니다 (앱 필요).
format에 따라 PNG 또는 Excalidraw JSON.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      format: { enum: ['png', 'excalidraw'], default: 'excalidraw' },
    },
  },
}
```

### `draw_get_session_path`

```ts
{
  name: 'draw_get_session_path',
  description: `
현재 세션의 작업 디렉토리 절대 경로를 반환합니다.
uploads/, previews/ 서브디렉토리가 있습니다. 파일 참조 시 이 경로 기준.
  `.trim(),
  inputSchema: { type: 'object', properties: {} },
}
```

## Tool Handler 구현

```ts
// @drawcast/mcp-server/src/tools.ts
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SceneStore } from './store.js';
import type { LabelBox, PrimitiveId } from '@drawcast/core';

export function registerTools(server: Server, store: SceneStore, app: AppBridge) {
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      // ... all tool schemas
    ],
  }));

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'draw_upsert_box':
        return handleUpsertBox(args, store);
      case 'draw_upsert_edge':
        return handleUpsertEdge(args, store);
      // ...
      case 'draw_get_preview':
        return handleGetPreview(args, app);
      // ...
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

async function handleUpsertBox(args: unknown, store: SceneStore) {
  const parsed = UpsertBoxSchema.parse(args);  // zod validation

  const primitive: LabelBox = {
    kind: 'labelBox',
    id: parsed.id as PrimitiveId,
    text: parsed.text,
    shape: parsed.shape ?? 'rectangle',
    at: parsed.at,
    fit: parsed.fit,
    size: parsed.size,
    rounded: parsed.rounded,
    style: parsed.style,
  };

  if (store.isLocked(primitive.id)) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Primitive ${primitive.id} is locked (user edited). Use draw_unlock first.`,
      }],
    };
  }

  store.upsert(primitive);

  return {
    content: [{
      type: 'text',
      text: `Upserted ${primitive.id}`,
    }],
  };
}
```

### zod 스키마로 입력 검증

```ts
import { z } from 'zod';

const PointSchema = z.tuple([z.number(), z.number()]);

export const UpsertBoxSchema = z.object({
  id: z.string().min(1),
  text: z.string().optional(),
  shape: z.enum(['rectangle', 'ellipse', 'diamond']).optional(),
  at: PointSchema,
  fit: z.enum(['auto', 'fixed']).optional(),
  size: PointSchema.optional(),
  rounded: z.boolean().optional(),
  style: z.union([
    z.string(),
    z.object({
      preset: z.string().optional(),
      strokeColor: z.string().optional(),
      // ...
    }),
  ]).optional(),
});
```

## SSE Transport

```ts
// @drawcast/mcp-server/src/transport/sse.ts
import { createServer } from 'node:http';
import { SceneStore } from '../store.js';
import { compile } from '@drawcast/core';

export function createSseServer(store: SceneStore, port: number) {
  const http = createServer();
  const sseClients = new Set<Response>();

  http.on('request', (req, res) => {
    if (req.url === '/sse' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      sseClients.add(res);

      // 초기 씬 push
      const result = compile(store.getScene());
      sendEvent(res, 'scene', result);

      req.on('close', () => sseClients.delete(res));
    }

    // MCP JSON-RPC over SSE는 별도 endpoint
    // (SDK의 SSEServerTransport가 처리)

    if (req.url === '/preview' && req.method === 'POST') {
      handlePreviewUpload(req, res);
    }

    if (req.url === '/selection' && req.method === 'POST') {
      handleSelectionUpdate(req, res, store);
    }
  });

  store.on('change', () => {
    const result = compile(store.getScene());
    for (const client of sseClients) {
      sendEvent(client, 'scene', result);
    }
  });

  http.listen(port, () => {
    console.log(`DRAWCAST_PORT=${port}`);
    console.log('DRAWCAST_READY=1');
  });
}

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

## App ↔ MCP 역방향 채널

앱은 SSE로 "변경 수신"만 하지 않고, 역방향으로 요청도 보낸다:

| 경로 | 방법 | 용도 |
|---|---|---|
| `POST /selection` | body: `{ids: string[]}` | 사용자 선택 상태 동기화 |
| `POST /preview` | body: `{data: base64, mimeType}` | 앱이 렌더한 PNG 업로드 |
| `POST /clipboard-ack` | body: `{success: boolean}` | 클립보드 복사 결과 |
| `POST /edit-lock` | body: `{ids: string[], locked: boolean}` | 사용자가 수동 편집한 primitive 잠금 |
| `GET /session-path` | — | 세션 디렉토리 조회 |

### 앱 ↔ MCP가 서로 기다려야 하는 경우

`draw_get_preview`는 특히 주의:

1. CLI → MCP: `draw_get_preview` 호출
2. MCP → 앱 (SSE event): `{type: 'requestPreview', requestId: '...'}`
3. 앱 → Excalidraw: `exportToBlob({mimeType: 'image/png', ...})`
4. 앱 → MCP: `POST /preview` with `requestId`
5. MCP → CLI: tool response with image

이 왕복에서 타임아웃 10초. 앱이 연결 안 돼있으면 즉시 에러:

```ts
async function handleGetPreview(args: GetPreviewArgs, app: AppBridge) {
  if (!app.isConnected()) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'No app connected. Preview requires the Drawcast app to be running.',
      }],
    };
  }

  const requestId = crypto.randomUUID();
  const pngPromise = app.requestPreview(requestId, args);

  try {
    const png = await Promise.race([
      pngPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Preview timeout')), 10_000)
      ),
    ]);

    return {
      content: [{
        type: 'image',
        data: png.data,
        mimeType: 'image/png',
      }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Preview failed: ${err.message}` }],
    };
  }
}
```

## CLI 등록 자동화

앱이 CLI 설정을 자동 등록하는 로직. Tauri Rust 쪽에서:

### Claude Code

```rust
// packages/app/src-tauri/src/cli_setup.rs
pub fn register_claude_code(port: u16) -> Result<()> {
    // 방법 1: `claude mcp add` 명령 실행
    Command::new("claude")
        .args(["mcp", "add", "drawcast", &format!("http://localhost:{port}/sse"), "-s", "user"])
        .output()?;

    // 방법 2: ~/.claude.json 직접 편집
    let config_path = dirs::home_dir().unwrap().join(".claude.json");
    let mut config: serde_json::Value =
        serde_json::from_reader(std::fs::File::open(&config_path)?)?;

    config["mcpServers"]["drawcast"] = serde_json::json!({
        "url": format!("http://localhost:{port}/sse"),
    });

    std::fs::write(&config_path, serde_json::to_string_pretty(&config)?)?;
    Ok(())
}
```

### Codex CLI

```rust
pub fn register_codex(port: u16) -> Result<()> {
    let config_path = dirs::home_dir().unwrap().join(".codex/config.toml");
    let mut config: toml::Value = toml::from_str(&std::fs::read_to_string(&config_path)?)?;

    // [mcp_servers.drawcast]
    //   url = "http://localhost:43017/sse"
    config["mcp_servers"]["drawcast"]["url"] =
        toml::Value::String(format!("http://localhost:{port}/sse"));

    std::fs::write(&config_path, toml::to_string_pretty(&config)?)?;
    Ok(())
}
```

Drawcast 앱 자체는 사용자의 글로벌 Claude 설정 파일(`~/.claude.json` 등)을 편집하지 않는다. 대신 `chat_host`가 `claude`를 spawn할 때 `--mcp-config <session>/mcp.json` 플래그로 임시 MCP 설정 파일을 지정하며, 그 안에 우리 사이드카의 `http://127.0.0.1:<port>/sse` endpoint를 기재한다. 이는 세션 격리를 유지하고 사용자 전역 설정을 건드리지 않기 위함이다.

수동/헤드리스 경로도 제공: 사용자가 직접 `claude`/다른 MCP 클라이언트에 Drawcast MCP를 등록하려면 "Copy setup command" 버튼으로 stdio 실행 커맨드(`drawcast-mcp --stdio`)를 복사해서 붙여넣을 수 있다.

## 로깅

로깅 전략:

- stdio 모드: stderr만 사용 (stdout은 JSON-RPC 전용)
- SSE 모드: stdout/stderr 모두 자유. 앱이 stdout을 읽어 상태 파싱
- 파일 로그: `~/.drawcast/logs/mcp-{date}.log` (MVP에서는 생략, 향후)

## 단독 모드 CLI 서브커맨드

앱 없이 MCP 서버만 쓰는 경우를 위한 CLI:

```bash
# MCP 서버로 실행
drawcast-mcp --sse --port 43017
drawcast-mcp --stdio

# 단회성 컴파일
drawcast-mcp compile ./scene.json > out.excalidraw
drawcast-mcp compile ./scene.ts --format obsidian > out.md

# 설정 관리
drawcast-mcp config register-cli claude
drawcast-mcp config register-cli codex
```

## 테스트

### Tool handler unit test

```ts
describe('draw_upsert_box', () => {
  it('adds new primitive to store', () => {
    const store = new SceneStore();
    handleUpsertBox({ id: 'a', text: 'Hello', at: [0, 0] }, store);
    const scene = store.getScene();
    expect(scene.primitives.get('a' as PrimitiveId)).toMatchObject({
      kind: 'labelBox',
      text: 'Hello',
    });
  });

  it('rejects locked primitives', () => {
    const store = new SceneStore();
    store.lock('a' as PrimitiveId);
    const result = handleUpsertBox({ id: 'a', text: 'X', at: [0, 0] }, store);
    expect(result.isError).toBe(true);
  });
});
```

### Integration test with real MCP client

MCP SDK의 client를 사용해 stdio 모드 서버에 연결:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

it('handles round-trip over stdio', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/cli.js', '--stdio'],
  });
  const client = new Client({ name: 'test', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);

  const result = await client.callTool({
    name: 'draw_upsert_box',
    arguments: { id: 'a', text: 'Hello', at: [0, 0] },
  });

  expect(result).toMatchObject({ content: [{ type: 'text' }] });
});
```
