# 07. Session & IPC

## 세션 디렉토리 패턴

### 왜 필요한가

CLI 세계(Claude Code / Codex)와 앱 세계를 연결하는 접착제가 필요하다. 사용자가 스크린샷을 드래그드롭하면 CLI가 그 파일을 `@file.png` 형태로 참조할 수 있어야 하는데, 이건 **CLI의 작업 디렉토리(CWD)에 해당 파일이 실제로 존재할 때만 가능**하다.

해결: 앱이 세션마다 전용 디렉토리를 만들고, **CLI도 그 디렉토리에서 spawn**한다. 드래그드롭된 파일은 이 디렉토리의 `uploads/` 서브폴더에 저장되므로 CLI가 상대 경로로 즉시 참조 가능.

### 디렉토리 구조

```
~/.drawcast/
├── sessions/
│   ├── {session-id}/                 # 세션 하나당 하나
│   │   ├── .drawcast.json            # 세션 메타데이터
│   │   ├── scene.excalidraw          # 현재 씬 스냅샷 (주기적 자동 저장)
│   │   ├── uploads/                  # 사용자가 올린 파일들
│   │   │   ├── screenshot-1.png
│   │   │   └── paste-abc123.png
│   │   └── previews/                 # 앱이 생성한 PNG 스냅샷
│   │       └── snapshot-1730000000.png
│   └── ...
├── config.json                        # 글로벌 설정
└── logs/                              # (향후)
```

### `.drawcast.json` 스키마

```jsonc
{
  "id": "abc123def",
  "name": "인증 플로우 다이어그램",       // 사용자 지정 가능
  "createdAt": 1730000000000,
  "updatedAt": 1730001234567,
  "cliChoice": "claude-code",
  "theme": "sketchy",
  "lastKnownPort": 43017
}
```

### 세션 생성

```rust
// src-tauri/src/session.rs
pub fn create_session(app: &tauri::AppHandle) -> Result<Session, String> {
    let id = generate_session_id();  // nanoid
    let path = dirs::home_dir()
        .ok_or("no home dir")?
        .join(".drawcast/sessions")
        .join(&id);

    std::fs::create_dir_all(path.join("uploads"))?;
    std::fs::create_dir_all(path.join("previews"))?;

    let meta = SessionMeta {
        id: id.clone(),
        name: format!("Session {}", &id[..6]),
        created_at: now_millis(),
        updated_at: now_millis(),
        cli_choice: None,
        theme: "sketchy".to_string(),
        last_known_port: None,
    };
    std::fs::write(
        path.join(".drawcast.json"),
        serde_json::to_string_pretty(&meta)?,
    )?;

    Ok(Session { meta, path })
}
```

### 세션 전환

앱 상단 "세션 전환" 메뉴에서 기존 세션 선택 시:
1. 현재 터미널의 CLI 프로세스 종료
2. MCP 서버에 `/session-path` 새 값 전달 → SceneStore 초기화 후 씬 파일 로드
3. 새 세션 디렉토리에서 CLI 재spawn
4. Excalidraw updateScene

### 세션 자동 저장

MCP 서버가 primitive 변경 시 `scene.excalidraw` 파일을 덮어쓰기. 디바운스 500ms.

```ts
// @drawcast/mcp-server/src/persistence.ts
const debouncedSave = debounce((scene: Scene, path: string) => {
  const compiled = compile(scene);
  const envelope = serializeAsExcalidrawFile(compiled);
  fs.writeFileSync(path, JSON.stringify(envelope, null, 2));
}, 500);

store.on('change', () => {
  debouncedSave(store.getScene(), `${sessionPath}/scene.excalidraw`);
});
```

MVP 범위 밖으로 명시했던 "영구 저장"과 다름 — 이건 **현재 세션의 활성 상태 보존**이지 기록이 아니다. 앱 재시작 시 마지막 세션이 그대로 복구되기만 하면 충분.

## 파일 업로드

### 3가지 입력 경로

1. **드래그드롭**: 좌측 패널 어디에든 파일 드롭
2. **클립보드 붙여넣기**: `Cmd+V` / `Ctrl+V`로 이미지 붙여넣기
3. **파일 선택 다이얼로그**: 상단 📎 버튼으로 시스템 다이얼로그

### 드래그드롭 구현

```tsx
// src/panels/TerminalPanel.tsx
export function TerminalPanel() {
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    await uploadFiles(files);
  }, []);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="relative h-full"
    >
      {/* xterm.js 컨테이너 */}
    </div>
  );
}

async function uploadFiles(files: File[]) {
  const sessionPath = useSessionStore.getState().path;
  for (const file of files) {
    const targetName = sanitizeFilename(file.name);
    const arrayBuffer = await file.arrayBuffer();
    await invoke('save_upload', {
      sessionPath,
      filename: targetName,
      data: Array.from(new Uint8Array(arrayBuffer)),
    });
  }

  // 사용자에게 알림
  const names = files.map(f => sanitizeFilename(f.name)).join(', ');
  toast.success(`업로드 완료: ${names}`);

  // 터미널 입력창에 참조 자동 삽입 (선택적)
  // 예: "@uploads/screenshot-1.png "
  if (files.length === 1) {
    terminalRef.current?.write(`\n@uploads/${sanitizeFilename(files[0].name)} `);
  }
}
```

### 클립보드 paste

```tsx
useEffect(() => {
  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const ext = item.type.split('/')[1];
          const name = `paste-${Date.now()}.${ext}`;
          await uploadFiles([new File([file], name, { type: item.type })]);
        }
      }
    }
  };
  document.addEventListener('paste', handlePaste);
  return () => document.removeEventListener('paste', handlePaste);
}, []);
```

### Rust 쪽 save_upload

```rust
#[tauri::command]
async fn save_upload(
    session_path: String,
    filename: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(&session_path)
        .join("uploads")
        .join(&filename);
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
```

### 파일명 sanitize

```ts
function sanitizeFilename(name: string): string {
  // 공백·특수문자 → `-`
  // 한글은 유지 (Claude Code가 잘 처리)
  return name
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 100);
}
```

## Selection Bridge

Excalidraw에서의 선택 → MCP 서버로 전파.

### 데이터 흐름

```
Excalidraw onChange
  → selectedElementIds (element id 기준)
  → primitive id로 역매핑
  → HTTP POST /selection
  → MCP SceneStore.setSelection()
  → CLI가 draw_get_selection() 호출 시 이 값 반환
```

### 디바운스

xterm.js onChange는 매 프레임 호출될 수 있어 과잉. 150ms 디바운스.

```ts
const pushSelection = useMemo(
  () => debounce((ids: string[]) => mcpClient.pushSelection(ids), 150),
  []
);

const onChange: ExcalidrawProps['onChange'] = (els, state) => {
  const selectedElementIds = Object.keys(state.selectedElementIds);
  const primitiveIds = mapElementsToPrimitives(selectedElementIds, els);
  pushSelection(primitiveIds);
};
```

### 명시적 피드백 경로

노드 우클릭 메뉴 "이 노드에 대해 피드백 주기":

```tsx
function onRightClick(e: React.MouseEvent, primitiveId: string) {
  e.preventDefault();
  const name = getPrimitiveName(primitiveId);
  terminalRef.current?.focusAndFill(`[node: ${primitiveId}] `);
}
```

터미널 입력창이 `[node: login-step] ` 프리필된 상태로 포커스. 사용자가 뒤이어 "색상 좀 더 따뜻하게"라고 치면 Claude Code는 어느 노드에 대한 피드백인지 명확히 인지.

## Preview Pipeline

### 흐름 (상세)

```
1. CLI: draw_get_preview() 호출
2. MCP: SSE event 'requestPreview' with {requestId}
3. App (SSE subscriber): 이벤트 수신
4. App: excalidrawAPI.getSceneElements() + exportToBlob()
5. App: Blob → base64
6. App: POST /preview { requestId, data, mimeType }
7. MCP: pending Promise resolve → tool response with image
8. CLI (Claude Code): vision model이 이미지 해석 후 응답
```

### 구현

```ts
// App 측
window.addEventListener('message', async (e) => {
  if (e.data.type !== 'requestPreview') return;
  const { requestId, scale = 1, padding = 20 } = e.data;

  const api = window.excalidrawAPI;
  if (!api) {
    mcpClient.rejectPreview(requestId, 'Excalidraw not ready');
    return;
  }

  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  const blob = await exportToBlob({
    elements,
    appState,
    files,
    mimeType: 'image/png',
    exportPadding: padding,
    exportWithDarkMode: false,
  });

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), '')
  );

  mcpClient.uploadPreview(requestId, base64);
});
```

### 명시적 스냅샷 버튼

사용자가 "이거 한번 봐봐" 하고 싶을 때는 좌측 터미널 상단 📸 버튼:

1. 버튼 클릭 → `exportToBlob` 실행
2. `previews/snapshot-{timestamp}.png` 에 저장
3. 터미널 입력창에 `@previews/snapshot-xxx.png ` 프리필
4. 사용자가 메시지 이어 작성 후 enter

Claude Code의 이미지 첨부 기능으로 들어가 vision model이 분석.

### 단독 MCP 모드

앱 없이 MCP만 실행 중이면 `draw_get_preview` 호출 시:

```
{
  isError: true,
  content: [{
    type: 'text',
    text: 'Preview is only available when the Drawcast app is running. Use draw_export to get the scene JSON instead.'
  }]
}
```

## Copy 기능

### Copy as PNG

```ts
async function copyAsPNG(scale: 1 | 2 = 2) {
  const api = window.excalidrawAPI;
  const blob = await exportToBlob({
    elements: api.getSceneElements(),
    appState: api.getAppState(),
    files: api.getFiles(),
    mimeType: 'image/png',
    exportPadding: 20,
    getDimensions: (w, h) => ({ width: w * scale, height: h * scale, scale }),
  });

  await invoke('clipboard_write_image', {
    data: Array.from(new Uint8Array(await blob.arrayBuffer())),
  });

  toast.success('PNG 복사됨');
}
```

Rust 쪽:

```rust
#[tauri::command]
async fn clipboard_write_image(data: Vec<u8>) -> Result<(), String> {
    let image = image::load_from_memory(&data)
        .map_err(|e| e.to_string())?;
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_image(arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Owned(rgba.into_raw()),
    }).map_err(|e| e.to_string())?;

    Ok(())
}
```

### Copy as Excalidraw

Excalidraw 웹과 Obsidian Excalidraw 모두에서 붙여넣기 가능한 포맷. 2가지 MIME 동시 기록.

```ts
async function copyAsExcalidraw() {
  const elements = window.excalidrawAPI.getSceneElements();
  const files = window.excalidrawAPI.getFiles();

  // Clipboard envelope (paste로 삽입할 때)
  const clipboardJSON = JSON.stringify({
    type: 'excalidraw/clipboard',
    elements,
    files: Object.keys(files).length > 0 ? files : undefined,
  });

  // File envelope (전체 scene 덮어쓰기 용)
  const fileJSON = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://drawcast.app',
    elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null,
      gridStep: 5,
    },
    files,
  });

  // 양쪽 MIME 동시 쓰기
  await invoke('clipboard_write_excalidraw', {
    clipboardJson: clipboardJSON,
    fileJson: fileJSON,
  });

  toast.success('Excalidraw 복사됨');
}
```

Rust 쪽 — macOS/Windows/Linux 플랫폼별 multi-MIME 처리:

```rust
#[tauri::command]
async fn clipboard_write_excalidraw(
    clipboard_json: String,
    file_json: String,
) -> Result<(), String> {
    // arboard는 multi-format을 직접 지원하지 않음
    // 플랫폼별 분기 필요

    #[cfg(target_os = "macos")]
    {
        use cocoa::base::nil;
        use cocoa::foundation::{NSString, NSArray};
        use cocoa::appkit::{NSPasteboard, NSPasteboardTypeString};
        // NSPasteboard로 여러 type 동시 설정
        // ...
    }

    #[cfg(target_os = "windows")]
    {
        // clipboard-win 크레이트로 CF_UNICODETEXT + custom format
        // ...
    }

    #[cfg(target_os = "linux")]
    {
        // x11-clipboard / wayland-clipboard
        // ...
    }

    // Fallback: text/plain만
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(clipboard_json).map_err(|e| e.to_string())?;
    Ok(())
}
```

구현 현실: 모든 플랫폼에서 multi-MIME 완벽 지원은 복잡. **MVP에서는 `text/plain`만 써도 Excalidraw 웹과 Obsidian 플러그인이 둘 다 JSON 문자열을 감지해서 제대로 붙여넣기 된다**. 나중에 필요 시 네이티브 구현 확장.

### Export as file

```ts
async function exportAsFile(format: 'excalidraw' | 'obsidian') {
  const elements = window.excalidrawAPI.getSceneElements();
  const files = window.excalidrawAPI.getFiles();

  const content = format === 'excalidraw'
    ? JSON.stringify(serializeAsExcalidrawFile({ elements, files }))
    : serializeAsObsidianMarkdown({ elements, files });

  const ext = format === 'excalidraw' ? 'excalidraw' : 'excalidraw.md';
  const defaultPath = `scene.${ext}`;

  const path = await save({
    defaultPath,
    filters: [
      { name: format === 'excalidraw' ? 'Excalidraw' : 'Obsidian Excalidraw',
        extensions: [ext] },
    ],
  });

  if (path) {
    await writeTextFile(path, content);
    toast.success('저장 완료');
  }
}
```

## File paths in CLI context

CLI가 파일을 참조하는 방법 정리:

| 경로 | 의미 | 예시 |
|---|---|---|
| `@uploads/foo.png` | 세션의 uploads 디렉토리 | Claude Code의 path reference |
| `@previews/snap-x.png` | 세션의 previews 디렉토리 | 수동 스냅샷 첨부 시 |
| `./scene.excalidraw` | 현재 세션의 씬 파일 | CLI가 씬을 직접 읽고 싶을 때 |

CLI spawn 시 `cwd`를 세션 디렉토리로 설정했으므로 상대 경로가 그대로 동작.

## 사용자 편집 보존 (재언급)

이 문서의 맥락에서 한 번 더:

**MCP 서버는 사용자가 편집한 primitive를 자동 감지하기 어렵다** (앱이 알려줘야 함). 앱이 primitive별 version을 추적하고, 사용자 인터랙션으로 변경된 element를 발견하면 `POST /edit-lock {ids, locked: true}`.

`draw_upsert_*` 호출 시 MCP가 lock 상태 확인:

```ts
if (store.isLocked(primitive.id)) {
  return errorResponse(`Primitive ${primitive.id} is locked. Run draw_unlock first.`);
}
```

CLI는 이 에러를 받아 사용자에게 "XX 노드는 수동 편집된 상태입니다. 덮어쓰려면 unlock이 필요합니다"라고 안내.

UI에서는 "Reset edits" 버튼 하나로 전체 unlock 가능.
