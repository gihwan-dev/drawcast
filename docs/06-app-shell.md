# 06. App Shell

> **UI/UX 디테일은 이 문서에서 다루지 않는다.** 별도 디자인 레퍼런스는 `06a-ui-design.md`에 있다. 이 문서는 구조와 원칙만 다룬다.

## 책임

`@drawcast/app`은 다음 네 가지를 한다:

1. **MCP sidecar 관리**. 앱 시작/종료 시 MCP 서버 프로세스 생명주기 처리.
2. **Chat UI**. 좌측 패널에서 Claude에게 메시지를 보내고 스트리밍 응답을 렌더링한다. 여러 이미지·PDF·Markdown 등을 첨부해 한 번에 전달할 수 있다.
3. **Scene 뷰어**. 우측 패널에 Excalidraw 컴포넌트. MCP로부터 씬 변경 수신 → 렌더.
4. **양방향 IPC 브리지**. 사용자 선택 상태·파일 업로드·클립보드 복사 등 앱 ↔ MCP 소통.

## 기술 스택

| 계층 | 선택 |
|---|---|
| Shell | Tauri 2.x |
| Native | Rust (sidecar, 채팅 프로세스 supervisor, 파일시스템, 클립보드) |
| Frontend | React 18+, TypeScript |
| State | Zustand |
| Chat transport | `claude` CLI `--input-format stream-json --output-format stream-json --verbose` (NDJSON over stdio) |
| Drawing | `@excalidraw/excalidraw` |
| Bundler | Vite |
| Package manager | pnpm |

### Tauri를 쓰는 이유

- **Electron 대비 번들 크기 작음**. MCP sidecar까지 포함해도 macOS 기준 50MB 이하 목표.
- **sidecar 기능이 일급 지원**. `claude`·MCP 두 자식 프로세스를 동일한 방식으로 관리.
- **OS 네이티브 clipboard, filesystem, dialog** 접근이 Rust 쪽에서 깔끔.
- **WebView가 최신 Chromium/WebKit** → Excalidraw가 그대로 동작.

### xterm/PTY를 쓰지 않는 이유

초기에는 `claude` TUI를 xterm.js로 임베드하는 경로를 검토했으나 폐기했다:
- 대화형 TUI는 진짜 PTY를 요구하므로 `portable-pty` 같은 플랫폼 종속 의존이 늘어난다.
- 터미널 바이트 스트림에서는 툴 호출·토큰 사용량·rate limit 같은 구조화된 정보를 뽑아낼 수 없다.
- 첨부·승인 UI 같은 고수준 UX를 터미널 위에 얹는 비용이 크다.

대신 `claude -p --input-format stream-json --output-format stream-json --verbose` 경로로 **NDJSON 이벤트 스트림**을 받아 구조화된 채팅 UI를 직접 렌더한다. 이 모드는 사용자의 `~/.claude/` OAuth 세션을 그대로 사용하므로 **Claude Pro/Max 구독으로 과금**된다 (별도 API 키 주입 불필요).

## 프로젝트 구조

```
packages/app/
├── src/                              # React 프론트
│   ├── main.tsx                      # 엔트리
│   ├── App.tsx                       # 루트 컴포넌트
│   ├── panels/
│   │   ├── ChatPanel.tsx             # 메시지 리스트 + composer
│   │   └── CanvasPanel.tsx           # <Excalidraw /> 래퍼
│   ├── components/
│   │   ├── chat/
│   │   │   ├── MessageList.tsx       # 스크롤러블 말풍선 리스트
│   │   │   ├── Message.tsx           # user/assistant/tool_use/tool_result 한 개
│   │   │   ├── ChatComposer.tsx      # 입력창 + 첨부 슬롯 + 보내기
│   │   │   └── AttachmentChip.tsx    # 첨부 한 건의 pill 렌더
│   │   └── ...                       # 그 외 공용 UI
│   ├── store/
│   │   ├── sceneStore.ts             # MCP에서 수신한 씬
│   │   ├── sessionStore.ts           # 현재 세션 정보
│   │   ├── settingsStore.ts          # 테마, panel ratio 등
│   │   └── chatStore.ts              # 메시지 히스토리, draft, 스트리밍 상태
│   ├── mcp/
│   │   ├── client.ts                 # SSE 구독 + HTTP 역방향 채널
│   │   └── handlers.ts               # 서버 요청 핸들러 (preview 등)
│   ├── services/
│   │   ├── clipboard.ts              # Copy as PNG / Excalidraw
│   │   ├── uploads.ts                # 드래그드롭, paste 저장
│   │   └── chat.ts                   # Tauri invoke 래퍼 + 이벤트 구독
│   └── pages/
│       └── Welcome.tsx               # `claude` CLI 설치/로그인 유도
├── src-tauri/                        # Rust
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                    # Tauri 커맨드 등록 + setup
│   │   ├── sidecar.rs                # MCP 서버 spawn/관리
│   │   ├── chat_host.rs              # `claude` 자식 프로세스 supervisor
│   │   ├── clipboard.rs              # arboard 기반 multi-MIME
│   │   ├── uploads.rs                # 세션 디렉토리 저장
│   │   └── session.rs                # 세션 디렉토리
│   ├── binaries/                     # sidecar 바이너리 (빌드 시 복사)
│   ├── capabilities/default.json
│   ├── tauri.conf.json
│   └── Cargo.toml
├── index.html
├── vite.config.ts
└── package.json
```

## 레이아웃 구조 (추상)

```
┌─────────────────────────────────────────────────────────────┐
│  [Top Bar]                                                  │
│  - Session switcher                                         │
│  - Snapshot / Upload                                        │
│  - Theme selector                                           │
├─────────────────────────────┬───────────────────────────────┤
│                             │  [Right Top Toolbar]          │
│  [Chat Panel]               │  - Copy PNG                   │
│                             │  - Copy Excalidraw            │
│  Message list (scroll)      │  - Export file                │
│   • user 말풍선             │                               │
│   • assistant 말풍선        │                               │
│     (text delta + tools)    │  [Canvas Panel]               │
│   • tool_use / tool_result  │       <Excalidraw />          │
│                             │                               │
│  [Composer]                 │  [Selection indicator]        │
│  [attachment chips]         │                               │
│  [textarea] [Send]          │                               │
├─────────────────────────────┴───────────────────────────────┤
│  [Status Bar]                                               │
│  MCP · session · Chat state · rate limit resets in 1h 23m   │
└─────────────────────────────────────────────────────────────┘
```

좌 40% / 우 60% 기본 비율. 드래그로 조정 가능한 splitter.

## 인증과 과금 — 구독 경로 전용

Drawcast는 API 키를 **받지 않는다**. 모든 호출은 사용자 머신에 이미 로그인된 `claude` CLI의 OAuth 세션을 통과한다.

- 사용자가 `claude login`으로 Claude.ai Pro/Max 계정에 로그인하면 토큰이 `~/.claude/`(또는 OS keychain)에 저장된다.
- 우리는 그 바이너리를 `-p`로 spawn만 한다. 인증 주입 코드 없음, API 키 저장소 없음.
- `init` 이벤트의 `apiKeySource: "none"` 필드로 OAuth 경로 확인.
- `rate_limit_event`의 `rateLimitType: "five_hour"`는 구독 윈도우 쿼터 신호 — API 크레딧 경로가 아님.

사용자에게 요구하는 것:
1. `claude` CLI를 PATH에 설치.
2. `claude login` 1회 실행.

이게 전부다. Welcome 화면은 위 두 조건을 체크하고 안 되어 있으면 안내 링크를 띄운다.

## Chat 파이프라인

```
┌─ React ─────────────────────────┐
│  ChatPanel                      │
│   → chatStore.sendMessage(m)    │
│       m = { text, attachments } │
└──────────────┬──────────────────┘
               │ invoke("chat_send", { blocks })
               ▼
┌─ Rust (chat_host.rs) ───────────┐
│  ensure `claude` 자식 alive     │
│  stdin ← stream-json line       │
│    {"type":"user","message":... │
│     content:[text + images]}    │
└──────────────┬──────────────────┘
               │ subprocess stdout (NDJSON)
               ▼
┌─ Rust line parser ──────────────┐
│  type=system/init               │→ emit "chat-session"
│  type=assistant  delta          │→ emit "chat-assistant-delta"
│  type=assistant  complete       │→ emit "chat-assistant-message"
│  type=user (replay)             │→ emit "chat-user-echo"
│  type=rate_limit_event          │→ emit "chat-rate-limit"
│  type=result                    │→ emit "chat-turn-end"
│  (process exit)                 │→ emit "chat-exit"
└──────────────┬──────────────────┘
               │ tauri event
               ▼
┌─ React ─────────────────────────┐
│  chatStore reducer              │
│   · append delta → 말풍선 갱신   │
│   · tool_use 블록 → 칩으로 렌더   │
│   · result → isStreaming=false  │
└─────────────────────────────────┘
```

### 자식 프로세스 수명

`chat_host`는 **세션당 하나의 장수 자식**을 유지한다. 여러 메시지를 같은 프로세스 stdin으로 흘려보내 multi-turn 대화를 잇는다.
- 세션 전환 시 기존 자식을 `shutdown`(SIGTERM → 타임아웃 시 SIGKILL) 후 새 cwd로 재spawn.
- 사용자가 윈도우를 닫으면 Tauri `WindowEvent::CloseRequested`에서 동기적으로 `shutdown`.
- `chat_cancel` 커맨드는 현재 턴만 중단하고 프로세스는 살려둔다 (표준 해법: `--replay-user-messages`와 함께 새 session-id로 fork하거나, 단순히 자식을 죽이고 다음 메시지 전에 재spawn — MVP는 후자).

### 다중 파일 첨부

Anthropic 메시지 포맷 표준을 그대로 태운다. user 메시지의 `content` 배열에 text + image + document 블록을 섞어 넣는다.

```jsonc
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "text", "text": "이 두 이미지 비교해줘" },
      { "type": "image", "source": { "type": "base64",
          "media_type": "image/png", "data": "iVBORw0..." } },
      { "type": "image", "source": { "type": "base64",
          "media_type": "image/png", "data": "iVBORw0..." } },
      { "type": "document", "source": { "type": "base64",
          "media_type": "application/pdf", "data": "JVBERi0x..." } }
    ]
  }
}
```

프론트의 `ChatComposer`는:
- 드래그드롭·paste·파일 선택 버튼으로 첨부를 받아 임시 배열에 보관 (chip UI로 표시).
- 텍스트 파일(.md, .txt, .csv 등)은 `{type:"text"}` 블록으로 펼쳐 전달 (content block에 document type은 PDF/특정 MIME 용도).
- 이미지는 PNG/JPEG/GIF/WebP — base64 인코딩해 `image` 블록.
- PDF는 `document` 블록.
- 보내기 직전에 한 번에 JSON 라인으로 직렬화, `invoke("chat_send", { blocks })`.

세션 디렉토리의 `uploads/`에 저장되는 파일(기존 `saveUpload`/`saveUploads` 인프라 재사용)은 같은 흐름을 탄다. 업로드 저장과 메시지 첨부는 독립적으로 쓸 수 있다.

## Tauri 커맨드 & 이벤트

### `#[tauri::command]`
| 커맨드 | 시그니처 | 역할 |
|---|---|---|
| `chat_start` | `(session_path: String) -> ()` | 세션 디렉토리에서 `claude -p …` 자식 spawn. 기존 자식이 있으면 재사용. |
| `chat_send` | `(blocks: Vec<ContentBlock>) -> ()` | user 메시지 stream-json 라인을 자식 stdin에 기록. 한 번에 여러 첨부 포함. |
| `chat_cancel` | `() -> ()` | 현재 턴 중단 (자식 kill → 다음 `chat_send`가 재spawn). |
| `chat_shutdown` | `() -> ()` | 세션 종료. 자식 정리. |
| `chat_status` | `() -> ChatStatus` | `{ running, sessionId, lastRateLimit }` |
| `check_claude_installed` | `() -> bool` | Welcome 온보딩용. `claude` 바이너리 해석 성공 여부. |

세션/파일/클립보드/업데이터 커맨드는 기존대로 유지.

### 이벤트 (Rust → 프론트)
| 이벤트명 | 페이로드 | 의미 |
|---|---|---|
| `chat-session` | `{ sessionId, model, mcpServers, tools, apiKeySource }` | 자식의 `init`. UI에 모델 배지 등을 반영. |
| `chat-assistant-delta` | `{ turnId, text }` | 부분 텍스트 델타. 마지막 assistant 말풍선에 append. |
| `chat-assistant-message` | `{ turnId, message }` | 완성된 assistant 메시지(툴 사용 블록 포함). |
| `chat-user-echo` | `{ turnId, message }` | 자식이 `--replay-user-messages`로 되보낸 원문. ACK 용도. |
| `chat-tool-use` | `{ turnId, toolUseId, name, input }` | 툴 호출 시작 (UI 블록 렌더). |
| `chat-tool-result` | `{ turnId, toolUseId, output, isError }` | 툴 결과 수신. |
| `chat-rate-limit` | `{ rateLimitType, resetsAt, status, overageStatus }` | StatusBar에 표시. |
| `chat-turn-end` | `{ turnId, isError, usage, costUsd }` | `isStreaming=false`, 최종 usage 반영. |
| `chat-exit` | `{ code }` | 자식이 죽음. 재spawn 가능한 상태로 UI 전환. |

## 상태 관리

### chatStore

```ts
interface ChatMessage {
  id: string;                           // client-generated uuid
  role: 'user' | 'assistant';
  content: ContentBlock[];              // 표준 Anthropic content blocks
  toolUses: ToolUseBlock[];             // assistant 메시지에 한해 사용
  createdAt: number;
  isStreaming: boolean;                 // 델타 진행 중인 마지막 말풍선만 true
}

interface ChatDraft {
  text: string;
  attachments: Attachment[];            // 파일 바이트 + 메타
}

interface ChatState {
  messages: ChatMessage[];
  draft: ChatDraft;
  sessionId: string | null;             // claude 쪽 session uuid (-r 재개에 사용)
  model: string | null;
  rateLimit: RateLimitInfo | null;
  isStreaming: boolean;
  connected: boolean;

  appendDraft(text: string): void;
  addAttachment(a: Attachment): void;
  removeAttachment(id: string): void;
  clearDraft(): void;
  sendMessage(): Promise<void>;
  cancelTurn(): Promise<void>;
  reset(): void;                        // 세션 전환 시
  // … 리듀서류는 chat-* 이벤트 구독자에서 호출
}
```

### sceneStore, sessionStore, settingsStore

`sceneStore`·`sessionStore`는 변화 없음. `settingsStore`는 더 이상 `cliChoice`를 들고 있지 않다 — 유일한 CLI는 Claude이고, 선택지가 없다.

## MCP Client

변화 없음. 우리 MCP sidecar는 `claude` 자식이 `--mcp-config`로 자동 로드하므로, `claude`는 Drawcast MCP 도구(`mcp__drawcast__draw_*`)를 그대로 쓸 수 있다. 즉 채팅으로 "동그라미 그려줘" 하면 MCP 경유로 `draw_upsert_shape`가 호출되고 `sceneStore`가 갱신된다.

사이드카와 `claude` 자식 모두 같은 세션 디렉토리를 cwd로 갖도록 `chat_host`가 맞춘다. 사이드카의 `--mcp-config`는 기존대로 세션 파일에 기록되며 `cli_register`류의 홈디렉토리 Claude 설정 편집은 **더 이상 하지 않는다** (사용자 전역 Claude 설정을 건드리지 않음).

## Canvas Panel

변화 없음. 핵심 변경은 컨텍스트 메뉴와 스냅샷 버튼이 더 이상 xterm에 텍스트를 주입하지 않고, 대신 **ChatComposer의 draft에 append** 한다는 점이다 (`chatStore.appendDraft("...")`).

## 사용자 편집 보존

변화 없음. edit-lock 로직은 기존대로 유지.
