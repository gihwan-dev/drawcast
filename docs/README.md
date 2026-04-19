# Drawcast Docs

> Drawcast는 자연어 CLI로 구조화된 Excalidraw 다이어그램을 빠르게 뽑아주는 데스크톱 도구다. 이 폴더는 앱 개발에 필요한 설계 문서 세트다.

## 읽는 순서

### 전체 파악하고 싶으면
0. [프로젝트 개요](./00-project-overview.md) — 정체성, 철학, MVP 범위
1. [아키텍처](./01-architecture.md) — 3-패키지 monorepo 구조
10. [개발 로드맵](./10-development-roadmap.md) — PR 단위 단계별 계획

### `@drawcast/core` 구현하려면
2. [L2 Primitive 스펙](./02-l2-primitives.md) — 9개 원시 타입 전체 인터페이스
3. [Compile Pipeline](./03-compile-pipeline.md) — L2 → Excalidraw JSON 변환
4. [Theme System](./04-theme-system.md) — 스타일 토큰과 프리셋
8. [Excalidraw Reference](./08-excalidraw-reference.md) — 내부 스펙 퀵 레퍼런스 (개발 중 상시 참조)
9. [Pitfalls & Compliance](./09-pitfalls-and-compliance.md) — 10개 compliance 체크 + 28개 함정

### `@drawcast/mcp-server` 구현하려면
5. [MCP Server](./05-mcp-server.md) — tool schema, SceneStore, SSE transport

### `@drawcast/app` 구현하려면
6. [App Shell](./06-app-shell.md) — Tauri 구조 (UI 원칙)
6a. [UI/UX Design](./06a-ui-design.md) — Google Stitch DESIGN.md 규격, 토큰·컴포넌트·와이어
7. [Session & IPC](./07-session-and-ipc.md) — 파일 디렉토리, 선택 bridge, 복사

## 현재 상태

- [x] 설계 문서 11개 완성 (이 세트)
- [x] `06a-ui-design.md` — UI/UX 디자인 (Stitch DESIGN.md 포맷)
- [ ] Phase 0-6 구현

## 문서 간 의존 관계

```
00 (개요)
├── 01 (아키텍처)
│   ├── 02 (L2 primitives) ──┐
│   ├── 03 (compile) ────────┼─── @drawcast/core
│   ├── 04 (theme) ──────────┘
│   ├── 05 (MCP server) ──────── @drawcast/mcp-server
│   ├── 06 (app shell) ──┐
│   └── 07 (session/IPC) ┴────── @drawcast/app
├── 08 (Excalidraw 레퍼런스) ──── 02, 03, 04, 09 의 근거
├── 09 (pitfalls & tests) ────── 03 검증
└── 10 (roadmap) ────────────── 전체 구현 순서
```

## 문서 작성 원칙

- **코드 > 산문**. TypeScript interface·코드 조각으로 정확하게 말한다.
- **표 > 나열**. 참조용 정보는 표로.
- **"왜"를 빼먹지 않는다**. 결정의 이유를 명시해 미래의 자신/팀원이 이해할 수 있게.
- **UI/UX 디테일은 별도 처리**. 디자인 레퍼런스 리서치를 거친 뒤 `06a-ui-design.md`에서 구체화.

## 이름 정리

- 프로젝트명 `Drawcast`는 **임시 플레이스홀더**다. 확정 후 `drawcast` → 신규명으로 전역 검색·치환.
- 패키지 스코프 `@drawcast/*`도 동일하게 교체.

## 기술 스택 한눈에

| 영역 | 선택 |
|---|---|
| 모노레포 | pnpm workspace + turborepo |
| 언어 | TypeScript (core 순수 TS, app Rust + TS) |
| core | zero-IO 순수 함수, nanoid, lodash-es |
| mcp-server | `@modelcontextprotocol/sdk`, Node.js, bun build --compile |
| app shell | Tauri 2.x + Rust |
| frontend | React 18, Vite, Zustand |
| chat transport | `claude` CLI (`-p --input-format stream-json --output-format stream-json`), NDJSON over stdio |
| drawing | `@excalidraw/excalidraw` |
| test | Vitest, fast-check, Playwright |
| release | GitHub Actions matrix, Tauri updater |
