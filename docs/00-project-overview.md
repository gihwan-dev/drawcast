# 00. 프로젝트 개요

> **코드네임**: Drawcast (임시). 패키지 스코프 `@drawcast/*`. 최종 이름 확정 시 전역 검색-치환.

## 한 줄 정의

**자연어 CLI로 구조화된 Excalidraw 다이어그램을 빠르게 뽑아주는 데스크톱 도구.**

## 포지셔닝

### 우리가 하지 않는 것

- **Mermaid 대체**: README에 들어갈 Mermaid 소스가 필요한 사람은 Mermaid를 쓴다. 우리는 Mermaid 텍스트 산출물을 만드는 도구가 아니다.
- **Excalidraw 완전 대체**: 픽셀 단위 수작업 편집 환경을 앱 내부에 구현하지 않는다. 최종 편집은 Obsidian Excalidraw나 Excalidraw 웹에서 이루어진다.
- **다이어그램 영구 저장소**: 채팅 로그·씬 히스토리·버전 관리는 범위 밖(MVP 기준).

### 우리가 하는 것

- **구조화된 Excalidraw JSON의 빠른 초안 생성**
- **"레이아웃·바인딩·크기 계산은 시스템, 색감·미세조정·주석은 사람"** 원칙에 기반한 반복 작업 자동화
- **자연어 ↔ 시각 선택을 통한 양방향 피드백 루프** (Mermaid도 Excalidraw도 갖지 못한 고유 가치)
- **Excalidraw 네이티브 산출물** → Obsidian·웹 Excalidraw로 언제든 빠져나갈 수 있는 탈출구 보장

## 철학적 원칙

### 원칙 1: 시스템이 초안을, 사람이 최종을

L2 primitive는 **관계와 의도**를 표현한다. 좌표의 미세 조정·색상·손그림 주석 같은 **감성적 마무리**는 사람이 Excalidraw에서 직접 한다. 우리 도구가 마지막 편집 환경이 될 필요가 없다는 점이 MVP 범위를 크게 줄여준다.

### 원칙 2: 탈출구 없는 도구는 도구가 아니다

L2는 Excalidraw의 **모든 element type을 표현 가능**해야 한다. 사용자가 "이건 L2로 안 되네" 하고 막히는 순간, 우리 앱을 버리고 Excalidraw를 처음부터 손으로 그리게 된다. 사용 빈도가 낮아도 (freedraw, embed 등) coverage primitive로 pass-through 경로를 반드시 확보한다.

### 원칙 3: 사람의 편집을 덮어쓰지 않는다

CLI가 씬을 업데이트할 때 사용자가 이미 수동으로 만진 element는 **보존**된다. 이것은 부가 기능이 아니라 정체성의 핵심 — 우리 도구의 존재 이유가 "사람이 편집으로 빠져나갈 수 있다"인데, 편집을 덮어쓰면 약속을 어기는 것.

### 원칙 4: 세 환경 공통 호환

생성하는 JSON은 **Excalidraw 웹, Obsidian Excalidraw, `@excalidraw/excalidraw` npm** 세 환경 모두에서 수동으로 그린 것과 구별 불가능해야 한다. 커스텀 필드·비표준 확장 금지.

## 핵심 사용 시나리오

### 시나리오 A: 블로그 포스트 다이어그램

기술 블로그를 쓰는 중 "이 구조를 시각화하고 싶다"는 욕구가 생김. 터미널에 Claude Code로 자연어 설명 → 오른쪽 패널에 Excalidraw 렌더링 → "이 노드 색상은 좀 더 따뜻하게" 같은 피드백 1-2회 → Copy as Excalidraw → Obsidian vault의 포스트 draft에 붙여넣기 → 거기서 마무리.

### 시나리오 B: 아키텍처 스케치

회의 전 "이런 구조는 어떨까?"를 그려봐야 함. CLI로 컴포넌트 나열 → 자동 배치 → 노드 클릭으로 "이 블록을 더 자세히" → 세부 하위 다이어그램 생성 → PNG로 복사해서 Slack에 붙여넣기.

### 시나리오 C: 문서 일러스트

기존 스크린샷을 업로드 → "이 UI의 데이터 흐름을 보여주는 다이어그램을 그려줘" → 생성 → Obsidian으로 이주해 freedraw로 강조 표시 추가.

## 용어 정의

| 용어 | 정의 |
|---|---|
| **L1** | Excalidraw 공식 JSON 포맷 (raw elements + appState + files) |
| **L2** | Primitive 추상화 계층 (LabelBox, Connector 등 9개 원시 타입) |
| **L3** | Graph model (노드/엣지 + 자동 레이아웃). **MVP 범위 밖** |
| **L4** | Domain template (flowchart, sequence, mindmap 등). **MVP 범위 밖** |
| **Primitive** | L2의 element 단위. 하나 이상의 Excalidraw element로 컴파일됨 |
| **Scene** | 현재 렌더링 대상인 primitive 집합 + 테마 |
| **Compile** | L2 Primitive[] → Excalidraw Element[] 변환 |
| **Session** | 하나의 작업 단위. 전용 디렉토리와 씬을 가진다 |
| **Builder API** | MCP tool로 노출된 L2 조작 함수들 (`draw_upsert_box` 등) |
| **Core** | `@drawcast/core` — pure TS, L2 타입과 compile |
| **MCP Server** | `@drawcast/mcp-server` — 씬 상태 소유자, CLI 대상 tool 노출 |
| **App** | `@drawcast/app` — Tauri shell, 뷰어 + 채팅 UI + `claude` 자식 supervisor |

## MVP 범위 (기능 체크리스트)

| 기능 | 범위 |
|---|---|
| 파일 업로드 (드래그드롭·paste) | ✓ 필수 |
| 좌측 채팅 패널 (Claude + 다중 파일 첨부) | ✓ 필수 |
| 우측 Excalidraw 라이브 프리뷰 | ✓ 필수 |
| 노드 단위 피드백 (선택 → 자연어) | ✓ 필수 |
| 전체 피드백 (PNG 스냅샷 → 채팅 첨부) | ✓ 필수 |
| Copy as PNG / Copy as Excalidraw | ✓ 필수 |
| MCP 서버 (SSE) + Claude CLI OAuth 재사용 | ✓ 필수 |
| L2 Core 3 + Structural 2 + Coverage 4 | ✓ 필수 |
| 사용자 편집 보존 (Claude가 덮어쓰지 않음) | ✓ 필수 |
| L3 Graph model (자동 레이아웃) | ✗ 향후 |
| L4 Domain template (mermaid 어댑터 등) | ✗ 향후 |
| 채팅 로그 영구 저장 | ✗ 향후 |
| 씬 버전 히스토리 | ✗ 향후 |
| Undo/Redo (L2 레벨) | ✗ 향후 (Excalidraw 자체 undo는 동작) |
| 다중 사용자 동기화 | ✗ 향후 |

## 문서 구성

| # | 문서 | 담당 영역 |
|---|---|---|
| 00 | 프로젝트 개요 (이 문서) | 정체성, 용어, 범위 |
| 01 | 아키텍처 | 3-패키지 구조, 의존성, 배포 |
| 02 | L2 Primitive 스펙 | 9개 원시 타입 상세 |
| 03 | Compile Pipeline | L2 → Excalidraw 변환 로직 |
| 04 | Theme System | 스타일 토큰과 오버라이드 |
| 05 | MCP Server | tool schema, 상태, 전송 |
| 06 | App Shell | Tauri 구조, UI 원칙 (추상) |
| 07 | Session & IPC | 파일 디렉토리, 선택 bridge, 복사 |
| 08 | Excalidraw Reference | 내부 구조 퀵 레퍼런스 |
| 09 | Pitfalls & Compliance | 함정 체크리스트, 테스트 |
| 10 | Development Roadmap | MVP 단계, PR 분할 |

## 다음 단계

1. 이 개요를 팀과 공유해 정체성 합의 확정
2. `01-architecture.md`로 기술 구조 확정
3. `@drawcast/core` 패키지 스캐폴드부터 시작 (`10-development-roadmap.md` 참조)
