# 01. 아키텍처

## 3-패키지 monorepo

```
drawcast/
├── packages/
│   ├── core/              # @drawcast/core       (pure TS, zero IO, zero UI)
│   ├── mcp-server/        # @drawcast/mcp-server (Node.js, 씬 상태 소유자)
│   └── app/               # @drawcast/app        (Tauri + React, 뷰어)
├── pnpm-workspace.yaml
├── turbo.json             # 또는 nx
└── package.json
```

### 의존성 방향

```
@drawcast/mcp-server  ──depends──▶  @drawcast/core
@drawcast/app         ──depends──▶  @drawcast/core
@drawcast/app         ──spawns──▶   @drawcast/mcp-server (sidecar)
```

**엄격한 단방향**: core는 다른 패키지를 몰라야 한다. mcp-server와 app은 서로를 직접 참조하지 않고, 런타임에 SSE로 느슨하게 결합된다. 이 제약이 "app 없이 MCP만" / "MCP 없이 core만 library로 사용" 같은 배포 경로를 가능하게 한다.

## 각 패키지의 책임

### `@drawcast/core`

**순수 TypeScript, IO 없음, UI 없음**. 테스트 커버리지 집중 대상.

- L2 primitive 타입 정의 (`packages/core/src/primitives.ts`)
- `compile(primitives, theme)` 함수 (`packages/core/src/compile/`)
- 텍스트 측정 (폰트 메트릭 테이블 + 측정 함수)
- Binding 계산 (`resolveBinding`, `calculateFocusGap`)
- 테마 시스템 (`theme.ts`)
- ID 생성, versionNonce 생성 등 Excalidraw 호환 유틸

외부 의존: `nanoid`, `lodash-es` 정도만. DOM API 금지(텍스트 측정도 폰트 메트릭 정적 데이터로).

상세: `02-l2-primitives.md`, `03-compile-pipeline.md`, `04-theme-system.md`.

### `@drawcast/mcp-server`

**씬 상태를 소유하는 MCP 서버**. stdio/SSE 두 전송 지원.

- `SceneStore` — `Map<PrimitiveId, Primitive>` + theme 관리
- MCP tool handler (`draw_upsert_box`, `draw_upsert_edge` 등)
- SSE transport (`GET /sse`) — 씬 변경 push
- HTTP endpoint (`POST /preview` 등) — 앱과의 양방향 채널
- CLI entry (`drawcast-mcp --stdio` / `--sse --port 43017`)

배포 경로:
- `npm install -g @drawcast/mcp-server` → node 실행
- `bun build --compile` → 단일 바이너리 (darwin/linux/win × arm64/x64)
- 앱 번들에 sidecar로 포함

상세: `05-mcp-server.md`.

### `@drawcast/app`

**Tauri 셸 + React 프론트엔드**. 뷰어이자 Claude 채팅 호스트.

- Tauri (Rust) — MCP sidecar + `claude` 자식 supervisor (`chat_host`), 파일시스템, 클립보드
- React 프론트 — 좌측 Chat UI, 우측 `<Excalidraw />`
- MCP SSE subscriber — 씬 변경 → `excalidrawAPI.updateScene()`
- Selection bridge — Excalidraw 선택 상태 → MCP 서버
- 채팅 transport — `claude -p --input-format stream-json --output-format stream-json --verbose` NDJSON 양방향

상세: `06-app-shell.md`, `07-session-and-ipc.md`.

## 실행 모드

### 모드 1: 통합 앱 (일반 사용자)

```
┌─────────────────────────────────────────┐
│ Drawcast.app (macOS/Windows/Linux)     │
│                                         │
│  ┌─ Tauri Shell ────────────────────┐  │
│  │  ┌────────────┐  ┌────────────┐  │  │
│  │  │ Chat UI    │  │ Excalidraw │  │  │
│  │  │ (React)    │  │ (React)    │  │  │
│  │  └─────┬──────┘  └─────┬──────┘  │  │
│  │        │ invoke()      │         │  │
│  │  ┌─────▼──────────┐    │         │  │
│  │  │ chat_host (Rs) │    │         │  │
│  │  │ spawns claude  │    │         │  │
│  │  └─────┬──────────┘    │         │  │
│  └────────┼───────────────┼─────────┘  │
│           │ MCP auto-load │ updateScene│
│           ▼               ▼            │
│  ┌─ Sidecar: @drawcast/mcp-server ─┐  │
│  │    listens on :<auto>           │  │
│  │    owns SceneStore              │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

앱 시작 → Tauri가 sidecar로 MCP 서버 spawn → 프론트가 SSE 구독. 사용자 메시지는 Rust의 `chat_host`가 `claude -p --input-format stream-json --output-format stream-json --verbose` 자식 프로세스로 전달. `claude`는 사용자 `~/.claude/` OAuth(Pro/Max 구독)로 인증하고, `--mcp-config`로 우리 MCP 사이드카를 자동 로드해 도구 호출 → SceneStore 갱신 → 캔버스 반영의 사이클을 만든다.

### 모드 2: 단독 MCP (헤드리스)

```
Claude Code CLI ──▶ @drawcast/mcp-server (stdio) ──▶ .excalidraw 파일 출력
```

앱 없이 MCP 서버만 실행. CI/CD·n8n 워크플로우·블로그 빌드 파이프라인에서 다이어그램 자동 생성. `draw_get_preview`는 에러 반환 (GUI 필요), `draw_export`는 정상 동작.

### 모드 3: 개발 모드

```
pnpm dev → @drawcast/mcp-server (tsx, hot reload, :43017)
        → @drawcast/app (Tauri dev, connects to external MCP)
```

`beforeDevCommand`로 MCP를 먼저 띄우고 앱은 외부 MCP에 연결. 각 패키지 개별 reload 가능.

## Sidecar 번들링

### 빌드 파이프라인

1. `@drawcast/mcp-server` → `bun build --compile --target=bun-{platform}-{arch}` 로 네이티브 바이너리 추출
2. `packages/app/src-tauri/binaries/` 에 플랫폼별 배치
3. `tauri.conf.json`의 `bundle.externalBin`에 등록:
   ```json
   "externalBin": [
     "binaries/drawcast-mcp"
   ]
   ```
4. Rust 쪽에서 `Command::new_sidecar("drawcast-mcp").arg("--sse").spawn()`

### Port 협상

- 앱이 `--port auto` 로 sidecar 실행
- 서버가 사용 가능한 포트 선점 후 stdout에 `DRAWCAST_PORT=43017\n` 출력
- Rust가 stdout 첫 줄을 읽어 프론트에 IPC로 전달
- 프론트가 `http://localhost:{port}/sse` 구독

### 프로세스 lifecycle

- 앱 종료 시 Rust가 sidecar에 SIGTERM → 10초 타임아웃 후 SIGKILL
- sidecar 크래시 감지 → 프론트에 "MCP 서버 재시작 중..." 토스트 표시 후 자동 재시작 (최대 3회)

## Monorepo 도구 선택

### pnpm workspace

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

### turborepo

빌드 캐싱·의존성 그래프 관리. `turbo.json`:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### changesets

버전 관리. core가 breaking change면 mcp-server/app도 같이 bump. `pnpm changeset` 으로 변경 기록.

## 빌드 산출물

| 패키지 | 산출물 | 배포 채널 |
|---|---|---|
| `@drawcast/core` | CommonJS + ESM + `.d.ts` | npm (private 또는 public) |
| `@drawcast/mcp-server` | Node ESM + CLI bin + 네이티브 바이너리 | npm + GitHub Releases |
| `@drawcast/app` | macOS `.dmg`, Windows `.msi`, Linux `.AppImage` | GitHub Releases + Tauri updater |

## 확장 가능한 경로

이 아키텍처로 열리는 미래 경로:

- **VSCode extension**: core + mcp-server + WebView에 `<Excalidraw />`. app 재사용 없이 새 껍데기.
- **웹 버전**: core 그대로, mcp-server를 Cloudflare Worker에 올리고 웹앱이 SSE 구독.
- **Figma plugin**: mcp-server 호출해서 Figma로 역수입.
- **n8n node**: mcp-server에 HTTP 엔드포인트로 접근하는 커스텀 노드.
- **CI/CD**: `drawcast-mcp compile scene.ts > out.excalidraw` 서브커맨드로 빌드 타임 다이어그램 생성.

## TypeScript 프로젝트 설정

### 공통 tsconfig

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true
  }
}
```

`noUncheckedIndexedAccess`와 `exactOptionalPropertyTypes`는 core의 binding 계산 같은 까다로운 로직에서 버그를 잡아준다.

### 패키지별 타입 export

core는 타입과 runtime을 분리 export:

```ts
// @drawcast/core/package.json exports
{
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./types": { "types": "./dist/types.d.ts", "import": "./dist/types.js" },
  "./theme": { "types": "./dist/theme.d.ts", "import": "./dist/theme.js" }
}
```

mcp-server와 app은 `import type { LabelBox } from '@drawcast/core/types'`로 타입만 가져옴 → 번들 크기 최소화.
