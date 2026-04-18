# 06. App Shell

> **UI/UX 디테일은 이 문서에서 다루지 않는다.** 별도 디자인 레퍼런스 조사를 거쳐 `06a-ui-design.md`로 분리 예정. 이 문서는 구조와 원칙만 다룬다.

## 책임

`@drawcast/app`은 다음 네 가지를 한다:

1. **MCP sidecar 관리**. 앱 시작/종료 시 MCP 서버 프로세스 생명주기 처리.
2. **CLI 호스트**. 좌측 패널에 터미널 에뮬레이터로 Claude Code / Codex CLI 실행.
3. **Scene 뷰어**. 우측 패널에 Excalidraw 컴포넌트. MCP로부터 씬 변경 수신 → 렌더.
4. **양방향 IPC 브리지**. 사용자 선택 상태·파일 업로드·클립보드 복사 등 앱 ↔ MCP 소통.

## 기술 스택

| 계층 | 선택 |
|---|---|
| Shell | Tauri 2.x |
| Native | Rust (sidecar, IPC, 파일시스템, 클립보드) |
| Frontend | React 18+, TypeScript |
| State | Zustand |
| Terminal | xterm.js + `@xterm/addon-fit`, `@xterm/addon-ligatures` |
| Drawing | `@excalidraw/excalidraw` (latest) |
| Bundler | Vite |
| Package manager | pnpm |

### Tauri를 쓰는 이유

- **Electron 대비 번들 크기 작음**. MCP sidecar까지 포함해도 macOS 기준 50MB 이하 목표.
- **sidecar 기능이 일급 지원**. 별도 프로세스 관리 라이브러리 불필요.
- **OS 네이티브 clipboard, filesystem, dialog** 접근이 Rust 쪽에서 깔끔.
- **WebView가 최신 Chromium/WebKit** → Excalidraw가 그대로 동작.

## 프로젝트 구조

```
packages/app/
├── src/                          # React 프론트
│   ├── main.tsx                  # 엔트리
│   ├── App.tsx                   # 루트 컴포넌트
│   ├── panels/
│   │   ├── TerminalPanel.tsx     # xterm.js 래퍼
│   │   └── CanvasPanel.tsx       # <Excalidraw /> 래퍼
│   ├── store/
│   │   ├── sceneStore.ts         # MCP에서 수신한 씬
│   │   ├── sessionStore.ts       # 현재 세션 정보
│   │   └── settingsStore.ts      # 테마, CLI 선택 등
│   ├── mcp/
│   │   ├── client.ts             # SSE 구독 + HTTP 역방향 채널
│   │   └── handlers.ts           # 서버 요청 핸들러 (preview 등)
│   ├── services/
│   │   ├── clipboard.ts          # Copy as PNG / Excalidraw
│   │   ├── uploads.ts            # 드래그드롭, paste
│   │   └── cliSetup.ts           # CLI 자동 등록 UI
│   └── components/               # 공용 UI
├── src-tauri/                    # Rust
│   ├── src/
│   │   ├── main.rs
│   │   ├── sidecar.rs            # MCP 서버 spawn/관리
│   │   ├── cli_setup.rs          # ~/.claude.json, ~/.codex/config.toml 편집
│   │   ├── clipboard.rs          # arboard 기반 multi-MIME
│   │   └── session.rs            # 세션 디렉토리
│   ├── binaries/                 # sidecar 바이너리 (빌드 시 복사)
│   │   ├── drawcast-mcp-darwin-arm64
│   │   ├── drawcast-mcp-darwin-x64
│   │   ├── drawcast-mcp-linux-x64
│   │   └── drawcast-mcp-win-x64.exe
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
│  - CLI connect button                                       │
│  - Theme selector                                           │
│  - Settings                                                 │
├─────────────────────────────┬───────────────────────────────┤
│                             │                               │
│                             │  [Right Top Toolbar]          │
│                             │  - Copy PNG                   │
│                             │  - Copy Excalidraw            │
│                             │  - Export file                │
│                             │                               │
│  [Left Panel]               │  [Right Panel]                │
│                             │                               │
│  Drop zone + Terminal       │       <Excalidraw />          │
│                             │                               │
│  xterm.js                   │                               │
│  - Claude Code              │                               │
│  - Codex                    │                               │
│                             │                               │
│                             │  [Selection indicator]        │
│  [Left Bottom]              │   "Selected: login-step"      │
│  - Snapshot button          │                               │
│  - Input line               │                               │
├─────────────────────────────┴───────────────────────────────┤
│  [Status Bar]                                               │
│  MCP status · Session path · CLI: Claude Code connected     │
└─────────────────────────────────────────────────────────────┘
```

비율은 대략 좌 40% / 우 60%. 드래그로 조정 가능한 splitter.

## 상태 관리

### sceneStore

MCP 서버가 push한 compiled elements를 보관. React에서 `<Excalidraw />`에 전달.

```ts
// src/store/sceneStore.ts
import { create } from 'zustand';
import type { ExcalidrawElement, BinaryFiles } from '@excalidraw/excalidraw/types';

interface SceneState {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  warnings: Warning[];

  setFromServer: (payload: { elements: ExcalidrawElement[]; files: BinaryFiles }) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  elements: [],
  files: {},
  warnings: [],
  setFromServer: (payload) => set({
    elements: payload.elements,
    files: payload.files,
  }),
}));
```

### sessionStore

현재 세션 메타데이터.

```ts
interface SessionState {
  id: string;
  path: string;                     // 절대 경로
  createdAt: number;

  newSession: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
}
```

### settingsStore

영구화되는 사용자 설정 (`localStorage` 또는 Tauri store plugin).

```ts
interface SettingsState {
  theme: 'sketchy' | 'clean' | 'mono';
  cliChoice: 'claude-code' | 'codex' | null;
  mcpPort: number | null;
  panelRatio: number;               // 0.4 = 좌 40%

  // ...
}
```

## MCP Client

앱 시작 직후 MCP 서버에 연결.

```ts
// src/mcp/client.ts
export class McpClient {
  private eventSource: EventSource | null = null;
  private serverUrl: string;

  constructor(port: number) {
    this.serverUrl = `http://localhost:${port}`;
  }

  async connect() {
    this.eventSource = new EventSource(`${this.serverUrl}/sse`);

    this.eventSource.addEventListener('scene', (e) => {
      const payload = JSON.parse(e.data);
      useSceneStore.getState().setFromServer(payload);
    });

    this.eventSource.addEventListener('requestPreview', (e) => {
      const { requestId } = JSON.parse(e.data);
      this.handlePreviewRequest(requestId);
    });

    this.eventSource.addEventListener('requestClipboard', (e) => {
      const { format, requestId } = JSON.parse(e.data);
      this.handleClipboardRequest(format, requestId);
    });
  }

  async pushSelection(ids: string[]) {
    await fetch(`${this.serverUrl}/selection`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  async uploadPreview(requestId: string, pngBase64: string) {
    await fetch(`${this.serverUrl}/preview`, {
      method: 'POST',
      body: JSON.stringify({ requestId, data: pngBase64, mimeType: 'image/png' }),
    });
  }

  private async handlePreviewRequest(requestId: string) {
    const api = window.excalidrawAPI;
    if (!api) return;

    const blob = await api.getBlob?.({
      mimeType: 'image/png',
      exportPadding: 20,
    }) ?? await exportToBlob({
      elements: useSceneStore.getState().elements,
      mimeType: 'image/png',
      exportPadding: 20,
    });

    const dataUrl = await blobToDataURL(blob);
    const base64 = dataUrl.split(',')[1];

    await this.uploadPreview(requestId, base64);
  }
}
```

## Tauri Sidecar 관리

```rust
// src-tauri/src/sidecar.rs
use tauri::Manager;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri_plugin_shell::ShellExt;

pub struct McpSidecar {
    child: Option<CommandChild>,
    port: Option<u16>,
}

impl McpSidecar {
    pub async fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
        let (mut rx, child) = app
            .shell()
            .sidecar("drawcast-mcp")
            .map_err(|e| e.to_string())?
            .args(["--sse", "--port", "auto"])
            .spawn()
            .map_err(|e| e.to_string())?;

        let mut port: Option<u16> = None;

        // stdout에서 port 파싱 대기
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    if let Some(rest) = line.strip_prefix("DRAWCAST_PORT=") {
                        port = rest.trim().parse().ok();
                    }
                    if line.contains("DRAWCAST_READY=1") {
                        break;
                    }
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[mcp stderr] {}", String::from_utf8_lossy(&line));
                }
                _ => {}
            }
        }

        let port = port.ok_or("Failed to parse port from sidecar")?;

        // 프론트에 이벤트로 port 전달
        app.emit("mcp-ready", port).ok();

        // 백그라운드 로그 계속 읽기
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        println!("[mcp] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Stderr(line) => {
                        eprintln!("[mcp] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Terminated(_) => {
                        eprintln!("[mcp] terminated");
                        // TODO: 재시작 로직
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(Self { child: Some(child), port: Some(port) })
    }

    pub async fn shutdown(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
    }
}
```

### tauri.conf.json 설정

```json
{
  "bundle": {
    "externalBin": [
      "binaries/drawcast-mcp"
    ]
  },
  "plugins": {
    "shell": {
      "scope": [
        {
          "name": "binaries/drawcast-mcp",
          "sidecar": true,
          "args": [
            "--sse",
            { "validator": "^--port$" },
            { "validator": "^(auto|\\d+)$" }
          ]
        }
      ]
    }
  }
}
```

## Terminal Panel

xterm.js로 CLI spawn 및 I/O 연결.

```ts
// src/panels/TerminalPanel.tsx
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      theme: { /* ... */ },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // CLI spawn
    const cliChoice = useSettingsStore.getState().cliChoice;
    const cmd = cliChoice === 'claude-code' ? 'claude' : 'codex';

    invoke('spawn_cli', {
      cmd,
      cwd: useSessionStore.getState().path,
    });

    // stdout/stderr 수신
    const unlistenOut = listen<string>('cli-stdout', (e) => {
      term.write(e.payload);
    });

    // stdin 송신
    term.onData((data) => {
      invoke('cli_stdin', { data });
    });

    return () => {
      unlistenOut.then(fn => fn());
      term.dispose();
      invoke('kill_cli');
    };
  }, []);

  return <div ref={containerRef} className="h-full" />;
}
```

Rust 쪽 `spawn_cli`는 `Command::new(cmd).current_dir(cwd).spawn()` 으로 단순.

## Canvas Panel

`<Excalidraw />` 래퍼. sceneStore 구독해서 updateScene.

```tsx
// src/panels/CanvasPanel.tsx
import { Excalidraw } from '@excalidraw/excalidraw';

export function CanvasPanel() {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const elements = useSceneStore((s) => s.elements);
  const files = useSceneStore((s) => s.files);

  // 서버 push 시 updateScene
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    api.updateScene({ elements });
    api.addFiles(Object.values(files));
  }, [elements, files]);

  // 사용자 선택 → MCP 서버에 동기화
  const onChange = useCallback(
    (els: readonly ExcalidrawElement[], state: AppState) => {
      const selectedIds = Object.keys(state.selectedElementIds);
      const primitiveIds = mapElementsToPrimitives(selectedIds, elements);
      mcpClient.pushSelection(primitiveIds);
    },
    [elements]
  );

  return (
    <Excalidraw
      excalidrawAPI={(api) => {
        excalidrawAPIRef.current = api;
        (window as any).excalidrawAPI = api;  // preview 요청 등에서 접근
      }}
      onChange={debounce(onChange, 150)}
      initialData={{ elements: [], appState: { viewBackgroundColor: '#ffffff' } }}
    />
  );
}
```

### Element → Primitive mapping

Excalidraw element는 여러 개가 하나의 primitive에 속할 수 있음 (LabelBox = shape + text). 매핑을 위해 element의 `customData`에 primitive id를 심어야 한다.

```ts
// compile 시
element.customData = { drawcastPrimitiveId: primitive.id };
```

선택 시 역매핑:

```ts
function mapElementsToPrimitives(
  elementIds: string[],
  elements: readonly ExcalidrawElement[]
): string[] {
  const primitiveIds = new Set<string>();
  for (const id of elementIds) {
    const el = elements.find(e => e.id === id);
    const pid = (el?.customData as any)?.drawcastPrimitiveId;
    if (pid) primitiveIds.add(pid);
  }
  return [...primitiveIds];
}
```

## 사용자 편집 보존

MVP에서 단순한 전략:

- 사용자가 Excalidraw에서 요소 이동/수정 → `onChange` 콜백 발동
- 변경된 element의 primitive id를 찾아 MCP 서버에 `POST /edit-lock` 으로 lock 요청
- 이후 CLI가 해당 primitive에 `draw_upsert_*` 호출하면 MCP가 에러 반환
- "Reset edits" 버튼으로 lock 해제 가능

```ts
function detectUserEdits(
  prevElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[]
): string[] {  // primitive ids
  const editedPrimitives = new Set<string>();
  const prevMap = new Map(prevElements.map(e => [e.id, e]));

  for (const next of nextElements) {
    const prev = prevMap.get(next.id);
    if (!prev) continue;
    if (prev.version === next.version) continue;

    const pid = (next.customData as any)?.drawcastPrimitiveId;
    if (pid) editedPrimitives.add(pid);
  }

  return [...editedPrimitives];
}
```

단, 이 전략은 **MCP 서버 자체 push로 인한 version 증가**와 **사용자 편집으로 인한 version 증가**를 구분 못 함. 해결:

- MCP 서버는 scene push 시 element의 version을 **증가시키지 않음** (`version: 1`로 고정 또는 이전 버전 유지)
- 사용자 편집으로만 version이 올라감
- 앱이 `version > 1`인 element가 생기면 그 primitive를 lock

이 디테일은 구현 중 조정 필요.

## 다음 단계

이 문서는 구조와 원칙만 다룬다. 실제 UI/UX는 별도 디자인 리서치 후 `06a-ui-design.md`에서:

- 컬러 팔레트 (앱 자체의 셸 색상, Excalidraw의 테마와 별개)
- 타이포그래피
- 아이콘 시스템
- 드래그드롭 영역의 시각적 표현
- 세션 전환 UI 디자인
- Selection indicator 레이아웃
- 키보드 단축키 매핑
- 설정 화면 구조
- 다크모드
