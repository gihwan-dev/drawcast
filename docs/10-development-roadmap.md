# 10. Development Roadmap

> **이 로드맵은 "기능이 하나씩 완성되는 vertical slice"로 Phase를 쪼갠다.** Core 100% → MCP 100% → App 100% 순서가 아니다. 각 Phase 끝에 **데모 가능한 상태**가 되도록 조각들을 엮는다.

## Phase 0: 준비 (1-2일)

### 목표
monorepo 스캐폴드 완성. 세 패키지가 빈 상태로 서로 import 가능.

### 작업
- [ ] pnpm workspace + turborepo 세팅
- [ ] 세 패키지 생성 (`core`, `mcp-server`, `app`)
- [ ] 공통 tsconfig, eslint, prettier
- [ ] changesets 설정
- [ ] GitHub/GitLab 저장소·CI 기본 파이프라인 (lint, typecheck, test)
- [ ] `core`에 빈 `primitives.ts`와 `compile()` stub
- [ ] `mcp-server`에 빈 MCP server skeleton (tool 없음)
- [ ] `app`에 Tauri + Vite + React + Chat 패널 + `<Excalidraw />` 스켈레톤

### 성공 기준
- `pnpm install && pnpm build` 성공
- `pnpm dev`로 세 패키지 동시 dev 서버 기동
- 앱이 빈 Excalidraw를 화면에 띄움

### 참조
- `01-architecture.md` 전체

---

## Phase 1: Core 기반 (3-5일)

### 목표
`@drawcast/core`만으로 L2 primitive → `.excalidraw` JSON을 생성 가능. CLI에서 `.ts` 파일 컴파일해서 파일 출력되면 성공.

### 작업

**1.1 타입 정의 (1일)**
- [ ] `primitives.ts` — 9개 primitive 인터페이스 완성
- [ ] `theme.ts` — Theme 타입 + `sketchyTheme`·`cleanTheme`·`monoTheme`
- [ ] `types/excalidraw.ts` — `_ExcalidrawElementBase` 등 Excalidraw 타입 (`@excalidraw/excalidraw`에서 import type으로 재사용)

**1.2 기초 유틸 (0.5일)**
- [ ] `utils/id.ts` — `newElementId`, `randomInteger`
- [ ] `utils/baseElementFields.ts` — `_ExcalidrawElementBase` 기본값 생성
- [ ] `utils/angle.ts` — `degreesToRadians`

**1.3 텍스트 측정 (1일)**
- [ ] `metrics/fonts.ts` — FONT_METADATA 정적 데이터 (Excalifont 포함)
- [ ] `measure.ts` — `measureText({text, fontSize, fontFamily, lineHeight})`
- [ ] `wrap.ts` — `wrapText` (단어 단위 greedy)
- [ ] 단위 테스트: 영문/한글/mixed 샘플의 측정 오차가 실제 Excalidraw 대비 ±10% 이내

**1.4 Compile 파이프라인 (2일)**
- [ ] `compile/context.ts` — `CompileContext`
- [ ] `compile/passes.ts` — `passPositional`, `passRelational`, `passGrouping`
- [ ] `compile/emit/labelBox.ts` — 핵심 primitive
- [ ] `compile/emit/sticky.ts`
- [ ] `compile/emit/connector.ts` — binding 포함
- [ ] `compile/emit/group.ts`, `emit/frame.ts`
- [ ] `compile/emit/line.ts`, `emit/freedraw.ts`, `emit/image.ts`, `emit/embed.ts`
- [ ] `compile/resolveStyle.ts` — theme 해석

**1.5 Serialization (0.5일)**
- [ ] `serialize.ts` — `serializeAsExcalidrawFile`, `serializeAsClipboardJSON`

**1.6 Compliance runner (0.5일)**
- [ ] `testing/compliance.ts` — 10개 check (`09-pitfalls-and-compliance.md`)
- [ ] CI에서 compliance 테스트 실행

### 성공 기준
- 3-노드 flowchart를 L2로 만들어 `compile()` → JSON 파일로 출력
- 출력 JSON을 Excalidraw 웹에 drag-drop으로 로드 → 정상 렌더 (스타일 점프 없음)
- Obsidian Excalidraw에도 동일하게 로드됨
- Compliance 10개 check 통과
- 단위 테스트 커버리지 80%+

### 데모
```bash
# @drawcast/core 패키지만 설치
npm install @drawcast/core

# 간단한 Node 스크립트
node -e "
  const { compile, serializeAsExcalidrawFile, sketchyTheme } = require('@drawcast/core');
  const scene = { /* ... */ };
  const result = compile(scene);
  const envelope = serializeAsExcalidrawFile(result);
  console.log(JSON.stringify(envelope, null, 2));
" > out.excalidraw
```

### 참조
- `02-l2-primitives.md`
- `03-compile-pipeline.md`
- `04-theme-system.md`
- `09-pitfalls-and-compliance.md`

---

## Phase 2: MCP 서버 최소 동작 (3-4일)

### 목표
Claude CLI(또는 다른 MCP 클라이언트)가 MCP tool을 호출하면 JSON 파일이 자동으로 갱신되는 상태. 앱 없이도 다이어그램 생성 가능.

### 작업

**2.1 MCP SDK 통합 (0.5일)**
- [ ] `@modelcontextprotocol/sdk` 설치
- [ ] stdio transport
- [ ] 빈 tool list로 handshake 동작 확인

**2.2 Scene Store (0.5일)**
- [ ] `SceneStore` class
- [ ] EventEmitter 기반 change notification
- [ ] `upsert`, `remove`, `clear`, `setTheme`, `setSelection`, `lock/unlock`

**2.3 핵심 tool 구현 (2일)**
- [ ] `draw_upsert_box`
- [ ] `draw_upsert_edge`
- [ ] `draw_upsert_sticky`
- [ ] `draw_upsert_group`
- [ ] `draw_upsert_frame`
- [ ] `draw_upsert_shape` (coverage 통합)
- [ ] `draw_get_scene`, `draw_get_primitive`, `draw_remove`, `draw_clear`
- [ ] `draw_list_style_presets`, `draw_set_theme`
- [ ] `draw_export`
- [ ] zod로 모든 input 검증

**2.4 Persistence (0.5일)**
- [ ] 변경 시 `scene.excalidraw` 파일에 debounced save
- [ ] 시작 시 기존 파일 로드 (있으면)

**2.5 CLI entry (0.5일)**
- [ ] `drawcast-mcp --stdio`
- [ ] `drawcast-mcp --sse --port N`
- [ ] `drawcast-mcp compile <file>` 서브커맨드
- [ ] `drawcast-mcp config register-cli claude/codex`

### 성공 기준
- Claude Code 설정에 `drawcast` MCP 서버 수동 등록
- Claude Code에서 "박스 3개 그리고 화살표로 이어줘" → tool 호출 → `scene.excalidraw` 파일 갱신
- 갱신된 파일을 Excalidraw 웹에서 수동으로 열면 정상 표시
- Compliance check 통과

### 데모
```bash
# Claude Code 설정
cat ~/.claude.json
# {"mcpServers": {"drawcast": {"command": "drawcast-mcp", "args": ["--stdio"]}}}

# 세션 디렉토리로 이동
cd ~/work/diagram-test

# Claude Code 실행
claude
> 로그인 → 인증 → 홈 순서의 플로우차트를 그려줘

# scene.excalidraw가 자동 생성됨
open scene.excalidraw  # Excalidraw 웹으로 열려서 확인
```

### 참조
- `05-mcp-server.md`

---

## Phase 3: 앱 셸 (5-7일)

### 목표
Tauri 앱이 실행되면 MCP sidecar 자동 시작 + 좌측 Chat + 우측 Excalidraw + 실시간 동기화.

### 작업

**3.1 Tauri 기본 구조 (1일)**
- [ ] Tauri 2.x 프로젝트 세팅
- [ ] `tauri.conf.json` — window, bundle, plugin 설정
- [ ] React + Vite frontend
- [ ] 기본 레이아웃 (좌/우 splitter)

**3.2 Sidecar 관리 (1일)**
- [ ] `@drawcast/mcp-server`를 `bun build --compile`로 바이너리 빌드
- [ ] `packages/app/src-tauri/binaries/`에 플랫폼별 복사하는 빌드 스크립트
- [ ] `externalBin` 설정
- [ ] Rust `McpSidecar` struct — spawn, port parsing, graceful shutdown
- [ ] 앱 시작 → sidecar spawn → port를 frontend에 emit

**3.3 MCP Client (1일)**
- [ ] `src/mcp/client.ts` — EventSource 구독
- [ ] `scene` 이벤트 → `sceneStore.setFromServer`
- [ ] `requestPreview`, `requestClipboard` 이벤트 핸들러
- [ ] HTTP POST `/selection`, `/preview` 등 역방향 호출

**3.4 Canvas Panel (1일)**
- [ ] `<Excalidraw />` 래퍼
- [ ] `excalidrawAPI.updateScene` 연결
- [ ] `onChange`로 selection → MCP 전파 (디바운스 150ms)
- [ ] Element ↔ Primitive 역매핑 (`customData.drawcastPrimitiveId`)

**3.5 Chat Panel (2-3일)**
- [ ] Rust `chat_host` — `claude -p --input-format stream-json --output-format stream-json --verbose` 자식 supervisor
- [ ] NDJSON line parser + Tauri 이벤트 (`chat-session`, `chat-assistant-delta`, `chat-turn-end`, `chat-rate-limit`, `chat-exit` 등)
- [ ] `chat_start` / `chat_send(blocks)` / `chat_cancel` / `chat_shutdown` 커맨드
- [ ] 프론트 `ChatPanel`: 메시지 리스트, streaming 델타 렌더, assistant/tool_use/tool_result 블록 구분
- [ ] `ChatComposer`: 텍스트 입력 + 멀티파일 드롭/paste/picker → image/document/text content block 자동 분기
- [ ] 세션별 `--mcp-config <session>/mcp.json` 자동 작성(사이드카 SSE URL 기재) — 사용자 전역 `~/.claude.json`은 건드리지 않음

**3.6 세션 관리 (1일)**
- [ ] Rust `create_session`, `list_sessions`, `switch_session`
- [ ] `~/.drawcast/sessions/{id}/` 디렉토리 구조
- [ ] 상단 세션 드롭다운 UI

### 성공 기준
- 앱 실행 → MCP 서버 자동 시작 (백그라운드)
- 사용자가 터미널에서 이미 `claude login` 해둔 상태면 추가 인증 없이 채팅 바로 가능 (`apiKeySource: "none"` 확인)
- 좌측 채팅에서 "박스 3개 그리고 화살표로 이어줘" → 우측 Excalidraw에 실시간 반영
- 이미지 여러 장 드래그드롭 → 다음 메시지에 첨부로 전송
- 세션 전환 → 다른 씬 + 독립된 `claude` 자식 프로세스

### 참조
- `06-app-shell.md`
- `07-session-and-ipc.md` (세션 디렉토리 부분)

---

## Phase 4: 인터랙션 완성 (3-4일)

### 목표
드래그드롭, 선택 bridge, preview pipeline, 복사/내보내기 기능 완성.

### 작업

**4.1 파일 업로드 (1일)**
- [ ] 드래그드롭 — 좌측 패널에서 `onDrop`
- [ ] 클립보드 paste — `paste` 이벤트
- [ ] Rust `save_upload` command
- [ ] 업로드 후 ChatComposer draft에 첨부 chip 자동 추가 + 선택적으로 `@uploads/...` 참조 프리필
- [ ] 파일명 sanitize

**4.2 Selection Bridge (0.5일)**
- [ ] Excalidraw `onChange` → primitive id 매핑 → MCP push
- [ ] `draw_get_selection` tool 응답
- [ ] 노드 우클릭 메뉴 "이 노드에 대해 피드백 주기"

**4.3 Preview Pipeline (1일)**
- [ ] `draw_get_preview` tool → SSE event → app export → MCP upload
- [ ] 10초 타임아웃 처리
- [ ] 수동 📸 스냅샷 버튼 → `previews/` 저장 + 터미널 프리필

**4.4 Copy/Export (1.5일)**
- [ ] Copy as PNG — arboard + image crate
- [ ] Copy as Excalidraw — 최소 `text/plain`에 clipboard JSON (MVP)
- [ ] Export as file — 시스템 다이얼로그 + `.excalidraw` / `.excalidraw.md`
- [ ] 토스트 알림

### 성공 기준
- 스크린샷을 드래그드롭 → Claude Code가 그 이미지를 분석해 다이어그램 생성
- Excalidraw에서 노드 선택 → CLI에서 "이 노드의 색상을 바꿔줘" → 선택된 노드만 업데이트
- "이 다이어그램 어때?" → CLI가 PNG preview 요청 → vision model이 해석
- Copy as Excalidraw → Obsidian Excalidraw에 붙여넣기 정상
- Copy as PNG → Slack에 붙여넣기 정상

### 참조
- `07-session-and-ipc.md`

---

## Phase 5: 사용자 편집 보존 (2일)

### 목표
사용자가 Excalidraw에서 수동 편집한 element는 CLI가 덮어쓰지 않는다.

### 작업
- [ ] `onChange`에서 사용자 편집 감지 (version 증가 기반)
- [ ] 편집된 primitive id를 MCP에 `POST /edit-lock`
- [ ] MCP의 `draw_upsert_*` 핸들러에서 lock 체크 → 거부
- [ ] CLI 에러 응답에 "이 primitive는 lock됨" 메시지
- [ ] "Reset edits" 버튼 → 전체 unlock
- [ ] MCP 서버가 scene push 시 element version을 **증가시키지 않도록** 수정 (사용자 편집과 구별 위해)

### 성공 기준
- 사용자가 노드 하나를 드래그해서 위치 바꿈 → CLI가 해당 노드 re-upsert 시도 → 에러 반환
- 다른 노드들은 정상 업데이트됨
- "Reset edits" 후에는 다시 upsert 가능

### 참조
- `06-app-shell.md` (사용자 편집 보존 섹션)

---

## Phase 6: 배포 (2-3일)

### 목표
사용자가 다운로드해서 즉시 쓸 수 있는 상태.

### 작업

**6.1 빌드 파이프라인 (1일)**
- [ ] GitHub Actions matrix — macOS (arm64, x64), Windows, Linux
- [ ] `bun build --compile` 타겟별 sidecar 바이너리
- [ ] Tauri bundle (`.dmg`, `.msi`, `.AppImage`)
- [ ] 아티팩트 GitHub Releases 업로드

**6.2 자동 업데이트 (0.5일)**
- [ ] Tauri updater plugin 설정
- [ ] 업데이트 서명 키 관리

**6.3 코드 사이닝 (1일)**
- [ ] macOS: Apple Developer ID + notarization
- [ ] Windows: EV code signing 또는 self-signed

**6.4 첫 실행 UX (0.5일)**
- [ ] Welcome 화면 — `claude` 설치 + `claude login` 유도
- [ ] Claude CLI 설치 여부 감지 → 미설치 시 설치 링크 표시
- [ ] 로그인 상태 감지(간단히 `claude -p "ping"` 실패 여부로) → 미로그인 시 `claude login` 안내
- [ ] 예시 세션 제공 (load sample)

### 성공 기준
- 공식 다운로드 링크에서 파일 받아 설치 → 더블클릭 → "Connect CLI" → 다이어그램 생성까지 5분 이내

---

## Phase 7 (향후): L3·L4, 고급 기능

MVP 범위 밖이지만 로드맵 유지:

- **L3 Graph model + 자동 레이아웃** — ELK.js 또는 d3-dag를 core에 통합
- **L4 Template adapters** — Mermaid → L2, flowchart DSL → L2
- **채팅 로그 영구 저장** — 세션별 `.drawcast/history.jsonl`
- **씬 버전 히스토리** — git-like branching
- **L2 undo/redo** — primitive 레벨 time-travel
- **VSCode extension** — core + mcp-server 재사용
- **웹 버전** — Cloudflare Worker sidecar + SSE

## PR 분할 가이드

한 PR은 한 vertical slice. 리뷰 가능한 크기로:

| PR | Phase | 내용 | 크기 |
|---|---|---|---|
| #1 | 0 | monorepo 스캐폴드 + CI | S |
| #2 | 1.1 | L2 primitive types | S |
| #3 | 1.1 | Theme types + 3개 내장 테마 | S |
| #4 | 1.2, 1.3 | utils + 텍스트 측정 + 테스트 | M |
| #5 | 1.4 | compile pipeline + core emit 함수 | L |
| #6 | 1.4 | coverage emit 함수 | M |
| #7 | 1.5, 1.6 | serialize + compliance runner | M |
| #8 | 2.1, 2.2 | MCP SDK + SceneStore | M |
| #9 | 2.3 | MCP tools (핵심 3개) | M |
| #10 | 2.3 | MCP tools (나머지) | M |
| #11 | 2.4, 2.5 | persistence + CLI entry | M |
| #12 | 3.1, 3.2 | Tauri 스켈레톤 + sidecar | L |
| #13 | 3.3, 3.4 | MCP client + Canvas panel | M |
| #14 | 3.5 | Chat panel + chat_host sidecar | L |
| #15 | 3.6 | 세션 관리 | M |
| #16 | 4.1 | 파일 업로드 | M |
| #17 | 4.2 | Selection bridge | S |
| #18 | 4.3 | Preview pipeline | M |
| #19 | 4.4 | Copy/Export | M |
| #20 | 5 | 사용자 편집 보존 | M |
| #21 | 6.1, 6.2 | 배포 파이프라인 | L |
| #22 | 6.3, 6.4 | 코드 사이닝 + 첫 실행 UX | M |

**S**: < 500줄, **M**: 500-2000줄, **L**: 2000-4000줄.

## 주간 마일스톤 (예시)

- **Week 1**: Phase 0 + 1.1~1.3 (타입 + 측정)
- **Week 2**: Phase 1.4~1.6 (compile 완성). 데모: CLI에서 스크립트 → JSON 파일
- **Week 3**: Phase 2 전체. 데모: Claude Code에서 MCP tool 호출 → 파일 갱신
- **Week 4**: Phase 3.1~3.4. 데모: 앱 실행 → 터미널에서 명령 → 우측에 실시간 렌더
- **Week 5**: Phase 3.5, 3.6 + Phase 4.1. 데모: 드래그드롭 + 세션 전환
- **Week 6**: Phase 4.2~4.4. 데모: selection bridge + copy/export 전체
- **Week 7**: Phase 5 + 내부 테스트
- **Week 8**: Phase 6 + 공개 베타

총 **약 8주 fulltime 상당** (파트타임이면 비례 증가).

## 리스크 요소

### 기술적 리스크

| 리스크 | 완화 |
|---|---|
| 텍스트 측정 오차로 레이아웃 깨짐 | Phase 1.3에서 실제 Excalidraw 대비 시각 회귀 테스트 |
| Excalidraw 버전 업 시 호환 깨짐 | compliance runner + snapshot test + `convertToExcalidrawElements` golden test |
| Tauri sidecar가 특정 OS에서 crash | CI matrix로 macOS/Windows/Linux 실 기기 테스트 |
| 클립보드 multi-MIME의 플랫폼별 차이 | MVP는 text/plain fallback으로 시작, 네이티브는 Phase 4.4 이후 |
| Claude CLI의 stream-json 스키마 변동 | NDJSON 파서는 관대하게 작성(`type` 기준 dispatch, 모르는 필드 무시), 실측 샘플을 `docs/06-app-shell.md`에 박아 회귀 추적 |
| Claude CLI가 `-p` 모드에서 구독 billing 버그로 API 크레딧으로 샘 | `init` 이벤트의 `apiKeySource`와 `rate_limit_event`를 StatusBar에 노출해 사용자가 즉시 인지 가능 |

### 범위 리스크

- L3(자동 레이아웃) 유혹: "어차피 해야 하는 것 아닌가" → **거부**. MVP는 수동 좌표 지정. LLM이 좌표 고르는 게 생각보다 잘 됨.
- UI 욕심: "셋팅 패널, 테마 에디터, 라이브러리..." → **거부**. MVP는 Excalidraw 네이티브 산출물 생성이 목표. 셋팅은 환경변수/JSON으로.

### 외부 의존 리스크

- Excalidraw가 major 버전 업 하고 API 깨뜨리면? → core의 `baseElementFields()`와 emit 함수들만 업데이트. `convertToExcalidrawElements` fallback 활용.
- MCP 프로토콜이 바뀌면? → SDK 업데이트로 흡수.
- Claude CLI의 MCP 지원이 중단되면? → stdio 모드는 표준 프로토콜이라 다른 MCP-capable 클라이언트로 이식 가능. Drawcast MCP sidecar 자체는 독립 바이너리라 그대로 재사용.
- `claude` CLI가 stream-json 포맷이나 `CLAUDE_CODE_OAUTH_TOKEN`/OAuth 경로를 제거하면? → `chat_host`가 NDJSON 파서와 인증 탐색을 한 모듈로 격리하므로 교체 비용 제한적.

## 성공 정의

MVP가 "성공"했다고 판단할 조건:

1. **본인이 일상 작업에서 매일 쓰는가**. 블로그 포스트 하나 쓸 때 Drawcast로 다이어그램을 만들고, 그게 Mermaid보다 빠르다고 느껴지는가.
2. **팀원 3명 이상에게 공유했을 때 그들도 계속 쓰는가**. "재밌긴 한데..."가 아니라 "이거 없으면 답답함" 레벨.
3. **Obsidian Excalidraw 커뮤니티에 공유 → 반응**. niche 지만 target audience와 정확히 맞물림.

이 세 가지 중 2개 이상 충족 시 Phase 7 investment 정당화.

## 참조

- `00-project-overview.md` — 정체성, 범위
- `01-architecture.md` — 기술 구조
- `02-l2-primitives.md` ~ `04-theme-system.md` — core 구현
- `05-mcp-server.md` — MCP 구현
- `06-app-shell.md` ~ `07-session-and-ipc.md` — app 구현
- `08-excalidraw-reference.md` — Excalidraw 내부 스펙
- `09-pitfalls-and-compliance.md` — 테스트·검증
