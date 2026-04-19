# Drawcast

> 자연어 CLI로 구조화된 Excalidraw 다이어그램을 빠르게 뽑아주는 데스크톱 도구.

Tauri 기반 데스크톱 앱 + MCP 서버. 좌측 채팅 패널에 Claude로 메시지를 보내면(이미지·PDF·Markdown 여러 개 첨부 가능) 우측 Excalidraw 캔버스에 실시간 반영됩니다. 언제든 Copy as Excalidraw → Obsidian Excalidraw · Excalidraw 웹 · `@excalidraw/excalidraw` 어디로든 옮겨서 마무리 편집을 이어갈 수 있습니다.

인증은 사용자 머신에 이미 로그인된 `claude` CLI의 OAuth 세션을 재사용합니다 — **Claude Pro/Max 구독이 그대로 적용**되며 별도 API 키 설정이 필요 없습니다.

## 설치

[Releases](https://github.com/gihwan-dev/drawcast/releases)에서 플랫폼별 파일을 받으세요.

- **macOS (Apple Silicon)**: `Drawcast_<ver>_aarch64.dmg`
- **macOS (Intel)**: `Drawcast_<ver>_x64.dmg`
- **Windows**: `Drawcast_<ver>_x64_en-US.msi`
- **Linux**: `Drawcast_<ver>_amd64.AppImage`

### 첫 실행 안내 (코드 서명 없음 — 오픈소스 개인 프로젝트)

현재 배포물은 Apple Developer ID / EV 인증서 없이 빌드됩니다. 내용물은 전부 이 저장소의 GitHub Actions 워크플로우로 재현 가능하지만, OS는 "확인되지 않은 개발자"라고 경고합니다. 한 번만 우회하면 이후엔 정상 실행됩니다.

**macOS**
1. `Drawcast.dmg` 열고 `Drawcast.app`을 `/Applications`에 드래그.
2. Finder에서 `Drawcast.app` **우클릭 → 열기** (더블클릭하면 차단됨).
3. 경고창에서 **열기** 클릭.
4. 이후엔 Launchpad / Spotlight에서 정상 실행.

여전히 막히면 System Settings → Privacy & Security → 맨 아래 "Drawcast was blocked…" 옆 **Open Anyway**.

**Windows**
1. `.msi` 더블클릭.
2. SmartScreen 경고 → **추가 정보** → **실행**.

**Linux**
`chmod +x Drawcast_*.AppImage && ./Drawcast_*.AppImage`

## 쓰는 법

1. `claude` CLI 설치 + `claude login`으로 Pro/Max 계정 로그인 (한 번만).
2. Drawcast 앱 실행.
3. 좌측 채팅 패널에서 "박스 3개 그리고 화살표로 이어줘" 같이 자연어로 보내기 (이미지/PDF 여러 개 드래그드롭 가능).
4. 우측 Excalidraw에 실시간 반영.
5. 상단 우측 Toolbar에서 **Copy PNG** / **Copy Excalidraw** / **Export**로 내보내기.
6. 노드를 수동으로 드래그하면 잠기고 Claude가 그 노드를 덮어쓰지 않습니다. 해제하려면 우상단 **Reset edits**.

## 구조

- `@drawcast/core` — L2 primitive, compile pipeline, 테마, compliance (pure TS)
- `@drawcast/mcp-server` — SceneStore + 15개 MCP tool + stdio/SSE transport (Node)
- `@drawcast/app` — Tauri 2.x 셸 + React + Chat UI + `<Excalidraw />` (Rust + TS). 채팅 백엔드는 `claude -p --input-format stream-json --output-format stream-json` 사이드카.

자세한 설계는 [docs/README.md](docs/README.md).

## 개발

```bash
pnpm install
pnpm dev                          # 세 패키지 병렬 dev
pnpm --filter @drawcast/app tauri dev   # Tauri 앱 실행 (처음은 Rust 컴파일 수 분)
pnpm -r test                      # 전체 테스트
```

릴리스 절차는 [packages/app/RELEASE.md](packages/app/RELEASE.md).

## 라이선스

TBD.
