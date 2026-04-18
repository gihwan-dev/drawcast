# 06a. UI/UX Design — Drawcast

> Google Stitch DESIGN.md 규격을 채택했다 ([format spec](https://stitch.withgoogle.com/docs/design-md/format/), [skill source](https://github.com/google-labs-code/stitch-skills/blob/main/skills/design-md/SKILL.md)). 이 문서는 `@drawcast/app` 프론트엔드(`packages/app/src`)의 시각 시스템을 기술하며, AI 코딩 에이전트(Claude Code, Codex)가 그대로 토큰·컴포넌트로 옮길 수 있게 작성됐다. Excalidraw 캔버스 자체의 테마(`04-theme-system.md`)와는 **별개의 셸 디자인**이다.

**Project ID:** `drawcast-app`
**Scope:** Tauri 2.x WebView 내부 React 18 UI (top bar / left terminal / right canvas / status bar)
**Out of scope:** Excalidraw 캔버스 내부 element 스타일 (그건 04 문서 책임)

---

## 1. Visual Theme & Atmosphere

**무드:** *"Cozy Paper Studio"* — 따뜻한 종이 결과 손그림 펜 자국이 느껴지는 작업실. Obsidian의 차분한 학습실 분위기와 Excalidraw의 장난스러움을 섞고, Raycast/Linear 수준의 키보드 정밀도를 입혔다.

**밀도(Density):** *Medium-Compact*. 터미널 13px 모노 폰트와 Excalidraw 캔버스가 동시에 보이는 화면이라 셸 크롬은 최소화한다. 32px 버튼, 44px 탑바, 24px 상태바.

**디자인 철학:**
1. **셸은 무대, 캔버스가 주인공.** 앱 셸은 채도를 낮추고 캔버스(흰 종이)가 시각적 무게중심이 되게 한다.
2. **하드라인보다 머리카락 선(hairline).** 그림자 남발 대신 1px Hairline Brown으로 면을 구분 — sketchy 미감과 충돌하지 않게.
3. **손글씨는 양념으로만.** Excalifont는 로고/빈 상태/섹션 아이콘 같은 *moments*에서만 쓰고, 본문 UI는 Inter/Pretendard로 가독성 확보.
4. **셸은 캔버스의 색을 흉내내지 않는다.** Excalidraw 프리셋 색(파랑·주황·초록)은 셸에서 의미적 토큰(success/warning/info)으로만 사용 — 시각적 경쟁 회피.

**왜 이 무드인가:** Drawcast의 정체성은 "사람이 마무리하는 도구". 차갑고 미래지향적인 IDE 톤(VSCode dark)을 쓰면 "이 앱이 최종 편집기다"라는 잘못된 신호를 준다. 따뜻한 종이 톤은 "여기서 초안 → 다른 곳에서 마무리"라는 흐름을 시각으로 약속한다.

---

## 2. Color Palette & Roles

색은 모두 **descriptive name + hex + functional role** 트리플로 명시한다. Light/Dark 두 세트 모두 같은 의미 토큰 키를 가진다 (`bg.app`, `text.primary` 등).

### 2.1 Light Mode (default)

| Token | Descriptive Name | Hex | Role |
|---|---|---|---|
| `bg.app` | Paper Cream | `#FBF8F3` | 앱 셸 전체 배경. Excalidraw 캔버스(`#FFFFFF`)보다 5% 따뜻해 캔버스가 *떠 있는* 느낌 |
| `bg.panel` | Soft Bone | `#F4F0E8` | 좌측 터미널 패널, 사이드 도크 |
| `bg.elevated` | Pure Paper | `#FFFFFF` | 드롭다운, 모달, 툴팁 |
| `bg.canvas-stage` | Pure Paper | `#FFFFFF` | Excalidraw 호스팅 영역 (캔버스 자체 bg와 동일하게 끊김 없는 면) |
| `bg.hover` | Mist Hover | `#EFE9DC` | 인터랙티브 hover |
| `bg.active` | Pebble Press | `#E8E1D0` | active/pressed |
| `bg.selection` | Selection Amber | `#FFE7B0` | 텍스트/리스트 선택 하이라이트 |
| `border.hairline` | Hairline Brown | `#E5DFD3` | 1px 패널·카드 경계 |
| `border.strong` | Pencil Outline | `#C9C0AE` | 입력 필드 보더, 강조 경계 |
| `border.focus` | Drawcast Red | `#C92A2A` | 키보드 포커스 링 (2px) |
| `text.primary` | Charcoal Ink | `#1E1E1E` | 본문, 제목 (Excalidraw stroke와 동일해 캔버스↔셸 시선 이동 부드러움) |
| `text.secondary` | Pencil Gray | `#5C5751` | 보조 라벨, 메타 |
| `text.tertiary` | Whisper Gray | `#9C9590` | 비활성, placeholder, 캡션 |
| `text.inverse` | Paper Cream | `#FBF8F3` | 다크 표면 위 텍스트 (CTA 버튼 안) |
| `accent.primary` | Drawcast Red | `#C92A2A` | 주 CTA, 활성 탭, 선택 잠금 표시 |
| `accent.primary-hover` | Drawcast Crimson | `#A61F1F` | CTA hover |
| `status.success` | Forest Sage | `#2F9E44` | MCP 연결됨, CLI 등록 성공 |
| `status.warning` | Sunset Orange | `#E8590C` | 비호환 element, edit-lock 충돌 |
| `status.danger` | Deep Crimson | `#9B2C2C` | 에러, 파일 없음 |
| `status.info` | Indigo Sketch | `#1971C2` | 정보 배너, 도움말 |
| `terminal.bg` | Charcoal Ink | `#1E1E1E` | xterm 배경 (light 모드에서도 터미널은 다크 — 개발자 관습 존중) |
| `terminal.fg` | Parchment Glow | `#EDE6D7` | xterm 기본 글자 |

> **결정 근거:** `bg.app`을 순백이 아닌 `#FBF8F3`로 둔 이유는 Excalidraw 캔버스가 `#FFFFFF`일 때 두 면이 자연스럽게 분리되도록 하기 위함이다. 캔버스를 5% 더 밝게 두면 사용자 시선이 자동으로 캔버스로 빨려 들어간다.

### 2.2 Dark Mode

| Token | Descriptive Name | Hex | Role |
|---|---|---|---|
| `bg.app` | Slate Night | `#1A1715` | 앱 셸 배경 (warm dark, 순흑 회피) |
| `bg.panel` | Charcoal Slate | `#222020` | 좌 패널, 사이드 도크 |
| `bg.elevated` | Smoke Stone | `#2A2724` | 드롭다운, 모달 |
| `bg.canvas-stage` | Pure Paper | `#FFFFFF` | **다크모드여도 캔버스 stage는 흰색 유지** (Excalidraw 자체 dark 토글은 별개) |
| `bg.hover` | Hover Cocoa | `#2D2925` | hover |
| `bg.active` | Press Sienna | `#363129` | pressed |
| `bg.selection` | Amber Embers | `#5A4A1F` | 선택 하이라이트 |
| `border.hairline` | Twilight Brown | `#3A332B` | 패널 경계 |
| `border.strong` | Driftwood | `#5A5048` | 입력 보더 |
| `border.focus` | Drawcast Glow | `#FF6B6B` | 포커스 링 (다크에서 빨강 채도 ↑) |
| `text.primary` | Parchment Glow | `#EDE6D7` | 본문 |
| `text.secondary` | Faded Parchment | `#A8A097` | 보조 |
| `text.tertiary` | Dusk Gray | `#6E665E` | 비활성 |
| `text.inverse` | Slate Night | `#1A1715` | 밝은 표면 위 텍스트 |
| `accent.primary` | Drawcast Crimson | `#FF6B6B` | CTA |
| `accent.primary-hover` | Sunset Coral | `#FF8585` | CTA hover |
| `status.success` | Mint Glow | `#69DB7C` | |
| `status.warning` | Sunset Glow | `#FFA94D` | |
| `status.danger` | Ember Red | `#FF8787` | |
| `status.info` | Sky Sketch | `#74C0FC` | |
| `terminal.bg` | Slate Night | `#1A1715` | 다크에서는 셸과 동색 |
| `terminal.fg` | Parchment Glow | `#EDE6D7` | |

### 2.3 의미 토큰 매핑 (구현 가이드)

```ts
// packages/app/src/theme/tokens.ts
export const tokens = {
  light: {
    bg: { app: '#FBF8F3', panel: '#F4F0E8', elevated: '#FFFFFF', canvasStage: '#FFFFFF',
          hover: '#EFE9DC', active: '#E8E1D0', selection: '#FFE7B0' },
    border: { hairline: '#E5DFD3', strong: '#C9C0AE', focus: '#C92A2A' },
    text: { primary: '#1E1E1E', secondary: '#5C5751', tertiary: '#9C9590', inverse: '#FBF8F3' },
    accent: { primary: '#C92A2A', primaryHover: '#A61F1F' },
    status: { success: '#2F9E44', warning: '#E8590C', danger: '#9B2C2C', info: '#1971C2' },
    terminal: { bg: '#1E1E1E', fg: '#EDE6D7' },
  },
  dark: { /* 위 표대로 */ },
} as const;
```

CSS 변수로 노출(`:root[data-theme="light"] { --bg-app: #FBF8F3; ... }`)하고, Tailwind config의 `theme.extend.colors`에 매핑.

---

## 3. Typography Rules

### 3.1 폰트 패밀리

| Stack | Font | Use |
|---|---|---|
| `font.brand` | **Excalifont** | 로고("Drawcast"), 빈 상태 헤딩, 섹션 액센트만. 절대 본문에 쓰지 않음 |
| `font.ui` | **Inter** + **Pretendard Variable** + system-ui fallback | 모든 UI 텍스트(메뉴, 버튼, 라벨, 다이얼로그). 한글은 Pretendard가 자연스럽게 잡음 |
| `font.mono` | **JetBrains Mono** + Cascadia Code fallback | 터미널, 코드, 단축키 표기, 상태바 path |

**왜 Inter/Pretendard 듀얼:** Drawcast 첫 사용자는 한국어 사용자(작성자 본인 포함). Pretendard는 Inter의 metrics와 호환되어 라틴/한글 혼용 시 줄간격이 안 깨진다.

### 3.2 타입 스케일

| Role | Family | Size / Line | Weight | Letter-spacing |
|---|---|---|---|---|
| Display (빈 상태 헤드) | Brand | 32 / 40 | 400 | 0 |
| H1 (다이얼로그 제목) | UI | 20 / 28 | 600 | -0.01em |
| H2 (패널 헤더) | UI | 15 / 22 | 600 | 0 |
| H3 (그룹 라벨) | UI | 13 / 20 | 600 | 0.02em (uppercase 가능) |
| Body | UI | 14 / 22 | 400 | 0 |
| Body Strong | UI | 14 / 22 | 600 | 0 |
| Caption | UI | 12 / 18 | 400 | 0 |
| Mono Body | Mono | 13 / 20 | 400 | 0 |
| Mono Caption | Mono | 11 / 16 | 400 | 0 |
| Kbd | Mono | 12 / 16 | 500 | 0.02em |

**캐릭터:** Letter-spacing은 거의 0 — 종이 톤과 어울리는 자연스러운 글자 간격. 헤딩만 살짝 negative tracking으로 단단함.

### 3.3 본문 색상 페어링

| Surface | Body text | Secondary text |
|---|---|---|
| `bg.app` Paper Cream | Charcoal Ink | Pencil Gray |
| `bg.panel` Soft Bone | Charcoal Ink | Pencil Gray |
| `bg.elevated` Pure Paper | Charcoal Ink | Pencil Gray |
| `terminal.bg` Charcoal Ink | Parchment Glow | Faded Parchment |
| `accent.primary` Drawcast Red | Paper Cream (inverse) | — |

Charcoal Ink on Paper Cream = 16.4:1 contrast (WCAG AAA).

---

## 4. Component Stylings

### 4.1 Top Bar (44px tall)

- **Shape:** 직사각형, 하단 1px Hairline Brown.
- **Background:** `bg.app` (Paper Cream / Slate Night).
- **Layout (좌→우):** Logo "✏️ Drawcast" (Excalifont 16px) · Session switcher chip · spacer · CLI status badge · Theme dropdown · Settings icon.
- **Behavior:** Drag region 활성화 (`-webkit-app-region: drag`), 인터랙티브 요소만 `no-drag`.

### 4.2 Buttons

세 가지 variant:

| Variant | Background | Border | Text | Use |
|---|---|---|---|---|
| **Primary** | `accent.primary` Drawcast Red | none | `text.inverse` Paper Cream | "Connect CLI", "New session" 등 주 액션 (한 화면에 1개) |
| **Secondary** | transparent | 1px `border.strong` Pencil Outline | `text.primary` Charcoal Ink | "Cancel", "Open folder" |
| **Ghost** | transparent | none | `text.primary` | 툴바 아이콘 버튼, 메뉴 항목 |

- **Shape:** *Subtly rounded corners* (`radius.md = 6px`). Pill 처리는 chip 전용.
- **Sizes:** 28 / 32 / 36 (sm / md / lg). 기본 32.
- **Behavior:**
  - Hover: `bg.hover` 오버레이.
  - Pressed: `bg.active` + 1px 안쪽으로 살짝 가라앉는 transform (`translateY(0.5px)`).
  - Focus: 2px Drawcast Red outline + 1px Paper Cream halo (offset 1px).
  - Disabled: opacity 0.4, cursor not-allowed.
- **Loading state:** 좌측 14px 손그림 spinner SVG (회전 애니메이션, `prefers-reduced-motion` 시 정적 점 3개).

### 4.3 Cards / Containers

- **Shape:** *Gently rounded corners* (`radius.lg = 10px` for modals, `radius.md = 6px` for panels).
- **Background:** `bg.elevated` Pure Paper.
- **Border:** 1px `border.hairline` (그림자 거의 없이 머리카락 선으로 부각).
- **Padding scale:** 12 (compact) / 16 (default) / 24 (modal body).
- **Header:** 36px tall, H2 텍스트, 하단 1px hairline.

### 4.4 Inputs / Forms

- **Shape:** `radius.sm = 4px`, 32px tall single-line, 80px tall textarea(min).
- **Background:** `bg.elevated`.
- **Border:** 1px `border.strong`. Focus 시 `border.focus` Drawcast Red 2px (border collapse — 두께 변화로 layout shift 없게 outline 사용).
- **Placeholder:** `text.tertiary` Whisper Gray.
- **Validation:** 에러 시 `status.danger` 보더 + 하단 12px 캡션 메시지.
- **Inline label 위치:** 입력 위 8px 간격, 13px 600 weight.

### 4.5 Splitter (좌·우 패널 사이)

- **Width:** 4px hit area (시각적으로는 1px Hairline Brown).
- **Behavior:** Hover 시 6px width로 두께만 늘어남 (`bg.hover` 채움), drag 시 `bg.active`.
- **Cursor:** `col-resize`.
- **Snap:** 25% / 40% / 50% / 60% 위치에 자석 효과 (5px 임계).

### 4.6 Status Bar (24px tall)

- **Background:** `bg.panel` Soft Bone, 상단 1px hairline.
- **Layout:** `[● MCP connected · drawcast/.../session-abc · CLI: Claude Code]` ← 좌측 정렬, 우측은 token usage / line:col / lock count.
- **Typography:** Mono Caption (11px). 상태 dot 6px 원, 색은 `status.*` 토큰.

### 4.7 Chip / Badge (Session switcher, status badges)

- **Shape:** Pill-shaped (`radius.full`).
- **Size:** 22px tall, 8px horizontal padding.
- **Background:** `bg.hover` (default), `bg.selection` (active).
- **Composition:** 6px status dot · 11px gap · 13px label · 4px gap · 12px chevron.

### 4.8 Dropdown / Menu

- **Container:** `bg.elevated`, `radius.md`, 1px hairline + soft shadow `0 8px 24px rgba(30,30,30,0.08)`.
- **Item:** 32px tall, 12px horizontal padding, hover `bg.hover`. 좌측 16px 아이콘 슬롯, 우측 단축키 mono caption.
- **Section divider:** 1px hairline, 4px vertical margin.

### 4.9 Tooltip

- **Background:** Charcoal Ink (light) / Pure Paper (dark) — 항상 inverse.
- **Text:** 12px text.inverse.
- **Shape:** `radius.sm`, 8px padding.
- **Delay:** 400ms open, 100ms close.

### 4.10 Drop Zone Overlay (파일 drag-over 시 좌 패널)

- **Trigger:** `dragenter` 시 패널 위에 풀 스크림.
- **Background:** Paper Cream `@ 92% opacity` (light) / Slate Night `@ 92%` (dark).
- **Border:** **Sketchy dashed border** — SVG로 손그림 점선을 그려 8px inset (Excalidraw `strokeStyle: 'dashed'` 미감 차용).
- **Content:** 중앙에 32px Excalifont "Drop to attach" + 14px 보조 캡션 "PNG, SVG, .excalidraw, 텍스트 파일".

### 4.11 Selection Indicator (Excalidraw 선택 → 좌 CLI에 컨텍스트로 전달)

- **Position:** 캔버스 패널 하단 중앙, 12px gap.
- **Container:** Pill-shaped chip, `bg.elevated`, 1px hairline, `0 4px 12px rgba(30,30,30,0.06)` shadow.
- **Content:** `▢ Selected: login-step` (16px shape preview SVG · 13px label · 4px gap · "✕ Esc").
- **Behavior:** 선택 1개 → primitive label, 다중 → "3 elements". `Esc` 또는 외부 클릭으로 dismiss.

### 4.12 Edit-Lock Indicator

사용자가 직접 만진 element는 CLI 덮어쓰기로부터 보호된다는 신호.

- **Visual:** 잠긴 primitive id를 가진 element 우상단에 14px 🔒 아이콘 (Lucide `lock`, `accent.primary` Drawcast Red).
- **Source:** Excalidraw 외부 오버레이 (캔버스 좌표 → DOM 좌표 변환). MutationObserver로 viewport 변경 시 위치 업데이트.
- **Toolbar:** 잠긴 element 1개 이상이면 status bar에 `🔒 2 locked` 표시 + 클릭 시 "Reset edits" 다이얼로그.

### 4.13 Snapshot Composer (좌 패널 하단)

전체 캔버스를 PNG로 떠서 CLI 입력에 첨부하는 단일 액션 영역.

- **Layout:** 좌측 32px 카메라 아이콘 버튼 · 가변 width 입력칸 · 우측 32px 전송 버튼.
- **State:** 입력 비었을 때 placeholder "Snapshot + 한 줄 피드백…", 캡처 중일 때 입력칸이 progress bar로 변신.

### 4.14 Toolbar (캔버스 우상단)

- **Position:** 캔버스 패널 내부 우상단 16px inset (Excalidraw 자체 UI와 겹치지 않게 `top: 80px`부터).
- **Container:** 가로 button group, `bg.elevated`, 1px hairline, `radius.md`.
- **Items:** Copy PNG / Copy Excalidraw / Export… 각 32px ghost button + 단축키 tooltip.

### 4.15 Command Palette (`⌘K`)

- **Container:** Centered modal 560×min(480, 70vh), top offset 15vh.
- **Header:** 48px 검색 입력 (Inter 16px), 좌측 16px ⌘K 아이콘.
- **List:** 36px rows, 단축키 우측 표기, 카테고리 그룹.
- **Backdrop:** Slate Night @ 40% opacity scrim.

### 4.16 Settings Dialog

- **Layout:** 720×560 modal, 좌측 180px 카테고리 nav · 우측 폼 영역.
- **Categories:** General · CLI · Theme · Shortcuts · MCP · About.
- **Save behavior:** 자동 저장 (입력 blur 시 즉시 persist), 토스트 "Saved" 1초.

---

## 5. Layout Principles

### 5.1 그리드 / 비율

- **앱 외곽:** 모든 화면 가장자리 0px (제로 chrome). 라운딩은 OS가 처리.
- **수평 분할:** Top bar 44 · 메인 가변 · Status bar 24. 메인 = 좌 패널 + 4px splitter + 우 패널.
- **기본 패널 비율:** 좌 40% / 우 60%. `settingsStore.panelRatio`로 영구화.
- **최소 창 크기:** 1024 × 640. 그 이하로 줄이면 좌 패널이 24% 최소값에서 멈춤.

### 5.2 Spacing Scale (4-pt base)

| Token | Px | Use |
|---|---|---|
| `space.xxs` | 2 | 인라인 아이콘-텍스트 |
| `space.xs` | 4 | 버튼 내부 아이콘-라벨, chip 사이 |
| `space.sm` | 8 | 인풋 padding, 좁은 stack |
| `space.md` | 12 | 카드 내부, 폼 row |
| `space.lg` | 16 | 패널 padding, 섹션 사이 |
| `space.xl` | 24 | 모달 body padding |
| `space.2xl` | 32 | 모달 사이 큰 섹션 |
| `space.3xl` | 48 | 빈 상태 vertical center 보정 |

### 5.3 Radius Scale

| Token | Px | Use |
|---|---|---|
| `radius.sm` | 4 | input |
| `radius.md` | 6 | button, card, chip slot |
| `radius.lg` | 10 | modal, large card |
| `radius.full` | 999 | pill chip, badge, dot |

### 5.4 Whitespace 철학

*Generous around, tight within.* 패널 외곽 padding은 16px로 넉넉하게 두지만, 폼 row 내부는 8-12px로 압축한다. 터미널이 화면 절반을 차지하기 때문에 셸 여백이 너무 크면 시각적으로 답답하다.

### 5.5 Z-index 스택

| Layer | z | Element |
|---|---|---|
| Base | 0 | 패널 본문 |
| Floating UI | 10 | Toolbar overlay, selection indicator |
| Drop overlay | 30 | 파일 드롭 스크림 |
| Popover/Dropdown | 50 | 메뉴, tooltip |
| Modal | 100 | Settings, Command palette, 다이얼로그 |
| Toast | 200 | 우하단 알림 |

---

## 6. Depth & Elevation

그림자는 *조심스럽게*. 종이 톤은 그림자가 진하면 즉시 플라스틱처럼 변한다.

| Level | Use | Light shadow | Dark shadow |
|---|---|---|---|
| `e0` | 패널 본문, 버튼 default | none — hairline border만 | none |
| `e1` | Selection indicator, toolbar overlay | `0 2px 6px rgba(30,30,30,0.05)` | `0 2px 6px rgba(0,0,0,0.30)` |
| `e2` | Dropdown, tooltip, popover | `0 8px 24px rgba(30,30,30,0.08)` | `0 8px 24px rgba(0,0,0,0.40)` |
| `e3` | Modal, command palette | `0 20px 48px rgba(30,30,30,0.12)` | `0 20px 48px rgba(0,0,0,0.55)` |

**원칙:** Light 모드에서는 hairline border가 1순위, 그림자가 보조. Dark 모드에서는 그림자가 1순위 (다크 표면끼리 hairline이 잘 안 보임).

---

## 7. Iconography

### 7.1 베이스 라이브러리

- **Lucide React** 0.4xx — 모든 UI 아이콘 (settings, copy, terminal, folder, lock, x, check, chevron 등).
- **Stroke width:** 1.75 (Lucide 기본 2 → 살짝 얇게, sketchy 톤과 어울림).
- **Sizes:** 14 (inline) / 16 (default) / 20 (toolbar) / 24 (empty state).

### 7.2 브랜드 / Sketchy 아이콘

- **로고 마크:** ✏️ 형태의 손그림 SVG (Excalifont 글자 "D"와 결합), 자체 제작 — `assets/brand/drawcast-mark.svg`.
- **빈 상태 일러스트:** 손그림 캔버스+커서 SVG, monochrome (text.secondary).
- **Drop zone 점선:** SVG path로 손그림 dashed (균일하지 않은 dash 길이).

### 7.3 의미적 아이콘 매핑

| Concept | Icon (Lucide) | 사용처 |
|---|---|---|
| New session | `file-plus` | Top bar, palette |
| Switch session | `folders` | Top bar |
| CLI connect | `terminal-square` | Top bar badge |
| Theme | `palette` | Top bar |
| Settings | `settings` | Top bar |
| Snapshot | `camera` | Left bottom composer |
| Send | `arrow-up` | Composer 전송 |
| Copy PNG | `image` | Canvas toolbar |
| Copy Excalidraw | `clipboard-copy` | Canvas toolbar |
| Export | `download` | Canvas toolbar |
| Lock | `lock` | Edit-lock overlay |
| Unlock | `unlock` | Reset edits |
| MCP status | `radio` | Status bar |
| Drop file | `file-down` | Drop overlay |
| Selection | `square-dashed-mouse-pointer` | Selection chip |

---

## 8. Motion & Interaction

### 8.1 Easing & Duration

| Token | Curve | Duration | Use |
|---|---|---|---|
| `motion.fast` | `cubic-bezier(0.4, 0, 0.2, 1)` | 120ms | hover/focus 변화 |
| `motion.base` | `cubic-bezier(0.2, 0, 0, 1)` | 200ms | 패널 토글, 다이얼로그 in |
| `motion.slow` | `cubic-bezier(0.2, 0, 0, 1)` | 320ms | 모달 backdrop fade |
| `motion.spring` | spring (stiffness 220, damping 28) | — | Selection indicator pop-in |

### 8.2 신호로서의 모션

- **씬 업데이트(MCP push):** Excalidraw 캔버스 자체는 instant. 상태바 MCP dot이 240ms 동안 채도 200% pulse → 정상 복귀.
- **Edit-lock 발생:** 잠긴 element 위 🔒 아이콘이 spring으로 scale 0 → 1.
- **Drop zone:** 200ms ease로 스크림 fade-in, sketchy border는 첫 240ms 동안 손으로 그어지듯 stroke-dashoffset 애니메이션.
- **Toast:** 우하단에서 8px translate-up + opacity, 1.6s 후 자동 dismiss.

### 8.3 Reduced motion

`@media (prefers-reduced-motion: reduce)` 시:
- 모든 transition < 80ms로 단축, transform 제거.
- Drop zone stroke-dashoffset 정적.
- MCP dot pulse → 단일 색 변경.
- Spring → ease.

---

## 9. Accessibility

### 9.1 WCAG 2.1 AA 체크

| 영역 | 처리 |
|---|---|
| 텍스트 대비 | Charcoal Ink/Paper Cream = 16.4:1, Pencil Gray/Paper Cream = 6.8:1 (AAA). Dark도 동일 검증 |
| Focus indicator | 모든 인터랙티브 2px Drawcast Red outline + 1px halo, never `outline: none` |
| 키보드 트래버설 | Tab 순서 = 시각 순서. 모달 open 시 focus trap, close 시 trigger로 복귀 |
| ARIA | Top bar `role="toolbar"`, status bar `role="status" aria-live="polite"`, drop overlay `aria-label="Drop files to attach"` |
| Hit target | 모든 클릭 가능 ≥ 32×32 (단, status bar dot은 24×24 + 8px padding) |
| 색만으로 의미 전달 금지 | 모든 status badge는 dot + text label 조합 |
| Form errors | 보더 색 + 아이콘 + 텍스트 캡션 (3중 단서) |

### 9.2 키보드 단축키 (전역)

| Action | macOS | Windows/Linux |
|---|---|---|
| 새 세션 | `⌘N` | `Ctrl+N` |
| 세션 전환기 | `⌘O` | `Ctrl+O` |
| Command palette | `⌘K` | `Ctrl+K` |
| Settings | `⌘,` | `Ctrl+,` |
| 좌 패널 toggle | `⌘B` | `Ctrl+B` |
| 우 패널 toggle | `⌘⇧B` | `Ctrl+Shift+B` |
| 터미널 포커스 | `⌘1` | `Ctrl+1` |
| 캔버스 포커스 | `⌘2` | `Ctrl+2` |
| Copy PNG (캔버스 포커스 시) | `⌘C` | `Ctrl+C` |
| Copy Excalidraw | `⌘⇧C` | `Ctrl+Shift+C` |
| Export… | `⌘E` | `Ctrl+E` |
| Snapshot to CLI | `⌘⇧S` | `Ctrl+Shift+S` |
| Excalidraw 테마 순환 | `⌘[` / `⌘]` | `Ctrl+[` / `Ctrl+]` |
| App 테마(L/D) toggle | `⌘⇧L` | `Ctrl+Shift+L` |
| 선택 dismiss / Drop 취소 | `Esc` | `Esc` |

> 터미널 안에서는 OS conflict 회피를 위해 `⌘C/V`는 xterm 자체 copy/paste로 위임. 캔버스 포커스 시에만 PNG copy로 동작.

### 9.3 Screen reader

- 모든 아이콘 버튼에 `aria-label`.
- 상태바 변경(MCP 연결, edit-lock 추가)은 `aria-live="polite"` region으로 announce.
- 모달은 `role="dialog" aria-labelledby aria-describedby` 세트.

---

## 10. Responsive Behavior

이 앱은 데스크톱 전용이지만 창 크기는 다양하다.

| Breakpoint | Width | 동작 |
|---|---|---|
| `compact` | ≥ 1024 | 기본. 양 패널 텍스트 라벨 표시, 캔버스 toolbar는 아이콘+라벨 |
| `tight` | < 1280 | 캔버스 toolbar는 아이콘 only, tooltip로 라벨 |
| `dense` | < 1100 | Top bar의 session switcher가 chip 라벨 truncate (12자) |
| `min` | < 1024 | 좌 패널이 24% min에 고정, splitter 숨김 |

세로 방향:
- < 600px height: status bar 숨김, top bar는 36px로 축소.
- < 480px height: 비공식 — 안내 토스트로 "창을 키워주세요" 표시.

터치/펜 입력은 MVP 범위 밖 (Tauri WebView가 처리하긴 함).

---

## 11. Do's and Don'ts

### Do
- 셸 면은 항상 머리카락 선 + 종이 톤. 색은 status/accent 토큰으로 *작게* 찍는다.
- Excalifont는 로고/빈 상태/일러스트 헤딩 같은 *드문 순간*에만.
- 캔버스 패널은 항상 `#FFFFFF` (다크모드여도). 사용자가 캔버스를 다크로 보고 싶으면 Excalidraw 자체 토글 사용.
- 키보드 단축키를 메뉴/툴팁에 항상 노출 — Linear/Raycast 사용자가 기대하는 학습 곡선.
- 상태(연결/잠금)는 dot+label 조합으로 색맹 안전.

### Don't
- 셸에 그라디언트, glassmorphism, neon glow 사용 금지.
- 캔버스 위에 셸 색을 흩뿌리지 않기 — toolbar는 항상 elevated white card.
- Lucide 아이콘에 stroke 2px 이상 두지 않기 (sketchy 톤과 충돌, 두꺼우면 만화 같음).
- "loading…" 같은 모호한 placeholder 대신 구체적 "MCP 서버 시작 중 (port 자동 할당)…".
- 다이얼로그를 슬라이드인으로 등장시키기 금지 — fade + 4px scale up만 (모션이 시각 noise 됨).
- Excalidraw 자체 UI(좌상단 메뉴, 우측 라이브러리)를 흉내내거나 가리기 금지.

---

## 12. Screen Wireframes

ASCII 와이어 — Tailwind/React 구현 시 레이아웃 구조 참조용. 실측 비율 아님.

### 12.1 Main Workspace (default state)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✏ Drawcast   ⌟ session-abc ▾    ● Claude Code   🎨 sketchy ▾   ⚙       │ 44 top bar
├─────────────────────────────────┬───────────────────────────────────────┤
│                                 │                            ┌─Toolbar┐ │
│                                 │                            │ 🖼 📋 ⤓ │ │
│                                 │                            └────────┘ │
│                                 │                                       │
│                                 │                                       │
│   xterm.js terminal             │       <Excalidraw canvas />           │
│                                 │                                       │
│   $ claude                      │              (#FFFFFF stage)          │
│   > /draw 사용자 로그인 흐름     │                                       │
│   ...                           │                                       │
│                                 │                                       │
│                                 │            ┌────────────────────┐    │
│                                 │            │ ▢ Selected: login   │    │
│                                 │            └────────────────────┘    │
│ ┌─────────────────────────────┐ │                                       │
│ │ 📷  Snapshot + 한 줄…    →  │ │                                       │
│ └─────────────────────────────┘ │                                       │
├─────────────────────────────────┴───────────────────────────────────────┤
│ ● MCP :47821  ⌟ ~/.../session-abc  CLI: Claude Code     🔒 0  · 1.4k tk │ 24 status
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.2 First-run / Onboarding

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                          ✏ Drawcast                                     │  display
│              (Excalifont 32px, text.primary)                            │
│                                                                         │
│         자연어로 Excalidraw 다이어그램의 초안을 받아보세요               │  body
│                                                                         │
│         Step 1.  사용할 CLI 선택                                        │
│         ┌──────────────┐  ┌──────────────┐                              │
│         │ ◎ Claude Code │  │ ○ Codex CLI  │                              │
│         └──────────────┘  └──────────────┘                              │
│                                                                         │
│         Step 2.  MCP 서버 등록 (자동)                                   │
│         [ Connect Drawcast to Claude Code ]   ← Drawcast Red CTA         │
│                                                                         │
│         스킵하고 직접 설정하려면 Settings → CLI                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.3 Drop Zone Active

```
┌─────────────────────────────────┐
│ ╲ ╲ ╲  (sketchy dashed inset) ╲ │
│  ╲                             ╲│
│   ╲                             │
│   ╲      📁  Drop to attach    ╲│  Excalifont 28
│   ╲      PNG · SVG · .excalidraw│  caption
│    ╲                            │
│     ╲                          ╲│
│ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ │
└─────────────────────────────────┘
```

### 12.4 Command Palette

```
┌────────────────────────────────────────────────┐  modal centered, top 15vh
│ 🔍  타입해서 명령 검색…                         │  48px input
├────────────────────────────────────────────────┤
│ ▸ Sessions                                     │  H3 group label
│   📁  새 세션                            ⌘N    │  36 row
│   📂  세션 전환기                        ⌘O    │
│   📤  현재 세션 내보내기                 ⌘E    │
│ ▸ Canvas                                       │
│   🖼  Copy as PNG                       ⌘C    │
│   📋  Copy as Excalidraw                ⌘⇧C   │
│   🎨  테마 순환 (sketchy → clean → mono) ⌘]   │
│ ▸ View                                         │
│   ⚪/⚫  앱 테마 토글                    ⌘⇧L   │
│   ◧   좌 패널 토글                       ⌘B    │
└────────────────────────────────────────────────┘
```

### 12.5 Settings Dialog

```
┌─────────────────────────────────────────────────────────┐  720×560
│ ⚙ Settings                                          ✕   │
├──────────┬──────────────────────────────────────────────┤
│ General  │  General                                     │
│ ▸ CLI    │  ─────────────                                │
│   Theme  │  앱 테마        [ ◎ Light ] [ ○ Dark ] [ ○ System ] │
│   Short. │  Excalidraw 기본 [ ◎ sketchy ] [ ○ clean ] [ ○ mono] │
│   MCP    │  세션 기본 위치 ┌──────────────────────────┐ │
│   About  │                 │ ~/Documents/drawcast     │ │
│          │                 └──────────────────────────┘ │
│          │                 [ 폴더 변경 ]                │
│          │                                              │
│          │  자동 업데이트  [ ▣ ] 자동 다운로드, 수동 설치 │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

### 12.6 Edit-Lock Conflict

```
┌─────────────────────────────────────────┐
│  ⚠  편집 잠금이 걸려 있어요              │  H1
│                                         │
│  CLI가 'login-step' 노드를 업데이트하려  │  body
│  했지만, 사용자가 이미 직접 수정한 상태  │
│  입니다.                                │
│                                         │
│  잠긴 primitive: 2개                    │  pencil gray
│  · login-step (수동 이동됨)             │
│  · success-edge (수동 색 변경)          │
│                                         │
│         [ 잠금 유지 ]  [ Reset edits ]  │  secondary / primary
└─────────────────────────────────────────┘
```

---

## 13. Implementation Notes

### 13.1 Tech 결정

| 항목 | 선택 | 이유 |
|---|---|---|
| 스타일링 | **Tailwind CSS 3.x** + CSS variables | 토큰을 CSS var로 두고 Tailwind config에서 참조 — 다크모드 토글이 `data-theme` 속성 한 줄로 끝남 |
| 컴포넌트 베이스 | **Radix UI** (Dialog, Popover, DropdownMenu, Tooltip 등) + 자체 스타일링 | 접근성·키보드 트래버설 무료, 시각은 100% 우리가 결정 |
| 아이콘 | **lucide-react** | 트리쉐이킹 좋고 stroke-width 컨트롤 가능 |
| 폰트 | self-host Excalifont (woff2), Inter (CDN or self), Pretendard Variable, JetBrains Mono | 오프라인 데스크톱이라 self-host 우선 |
| 모션 | **Framer Motion** (선택적) 또는 CSS transition | 단순한 fade/scale은 CSS, spring만 Framer |

### 13.2 디렉토리 구조 제안

```
packages/app/src/
├── theme/
│   ├── tokens.ts          # 위 §2.3 정의
│   ├── tailwind.config.ts # tokens.ts → tailwind colors
│   └── ThemeProvider.tsx  # data-theme 토글, OS prefers-color-scheme 감지
├── components/
│   ├── primitives/        # Button, Input, Chip, Card, Dropdown, Tooltip
│   ├── shell/             # TopBar, StatusBar, Splitter
│   ├── overlays/          # DropZone, SelectionIndicator, EditLockBadge, Toast
│   └── dialogs/           # CommandPalette, Settings, EditLockConflict, Snapshot
├── panels/
│   ├── TerminalPanel.tsx
│   └── CanvasPanel.tsx
└── App.tsx                # 그리드 레이아웃 (top / split / status)
```

### 13.3 다크 모드 토글 구현 핵심

```tsx
// ThemeProvider.tsx
const [mode, setMode] = useState<'light' | 'dark' | 'system'>('system');
useEffect(() => {
  const resolved = mode === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.dataset.theme = resolved;
}, [mode]);
```

```css
/* index.css */
:root[data-theme='light'] {
  --bg-app: #FBF8F3; --bg-panel: #F4F0E8; /* ... 전체 토큰 */
}
:root[data-theme='dark'] {
  --bg-app: #1A1715; --bg-panel: #222020; /* ... */
}
```

### 13.4 Excalidraw 호스팅 시 충돌 회피

- Excalidraw의 자체 폰트(Excalifont, Cascadia 등)와 우리 셸의 Inter가 같은 페이지에 공존 → font-family는 root에서 격리하지 않고 component-level로만 지정.
- Excalidraw가 자체 CSS variable로 `--default-bg-color` 등을 쓰므로, 우리 토큰 prefix는 `--dc-*`로 바꿔 충돌 회피 (`--dc-bg-app`).
- 캔버스 pane에 우리 셸의 dark 배경이 새지 않도록 `<CanvasPanel>` wrapper에 `bg-canvasStage`(#FFFFFF) 강제.

---

## 14. Agent Prompt Guide

이 섹션은 Claude Code / Codex 같은 코딩 에이전트가 이 디자인을 빠르게 적용할 때 복붙하는 reference.

### 14.1 빠른 색 참조 (Light)

```
Background:    Paper Cream (#FBF8F3)
Panel:         Soft Bone (#F4F0E8)
Card/Modal:    Pure Paper (#FFFFFF)
Border:        Hairline Brown (#E5DFD3)
Text:          Charcoal Ink (#1E1E1E) / Pencil Gray (#5C5751)
CTA:           Drawcast Red (#C92A2A)
Success / Warning / Danger / Info:
               #2F9E44 / #E8590C / #9B2C2C / #1971C2
Terminal:      bg #1E1E1E · fg #EDE6D7
```

### 14.2 코딩 에이전트용 프롬프트 (예시)

> "Drawcast의 `06a-ui-design.md`를 읽고, `packages/app/src/theme/tokens.ts`에 §2 표의 light/dark 토큰을 작성해줘. CSS 변수 노출(`:root[data-theme="..."]`)과 Tailwind config 매핑까지 포함. 이름 공간은 `--dc-*` prefix 사용."

> "`06a-ui-design.md` §4.2를 따라 `Button` primitive를 Radix Slot 기반으로 만들어줘. variants: primary/secondary/ghost, sizes: sm/md/lg. Focus state는 §9.1 규격을 정확히 따를 것."

> "§12.1 와이어를 React 컴포넌트로 구현. App.tsx는 grid `[44px_1fr_24px]`, 메인은 `flex` + 4px splitter. 좌:우 비율은 `useSettingsStore.panelRatio` 구독."

### 14.3 코드 리뷰 체크리스트

PR 리뷰 시 이 디자인 컴플라이언스 체크:

- [ ] 모든 색이 `var(--dc-*)` 또는 Tailwind 토큰 클래스 사용 (raw hex 금지)
- [ ] 새 인터랙티브 요소에 focus ring (§9.1)
- [ ] 단축키가 §9.2 표에 등록되거나 신규 단축키는 conflict 검토 완료
- [ ] 다크 모드에서 시각 검수 완료 (스크린샷 첨부)
- [ ] `prefers-reduced-motion` 분기 (§8.3)
- [ ] hit target ≥ 32×32 또는 의도적 예외 표기

---

## 15. Open Questions / Future

이 문서는 MVP 기준. 다음 결정은 구현 진행하며:

- **앱 이름 확정 시** Drawcast → 신규명 전역 치환 (로고 SVG, font.brand 사용처).
- **사용자 커스텀 테마**: §2 토큰을 JSON으로 노출하고 사용자가 드롭하면 머지 — Phase 2.
- **다국어**: 현재 카피가 한국어 위주. 영어 카피 deck 별도 필요 — UX writing 라운드.
- **터치/펜 모드**: Tauri mobile 검토 시 spacing scale 1.25× 적용 검토.
- **High contrast 모드**: WCAG AAA + Windows HCM 대응은 Phase 2.

---

## References

- [Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/)
- [Stitch DESIGN.md overview](https://stitch.withgoogle.com/docs/design-md/overview/)
- [google-labs-code/stitch-skills (design-md SKILL.md)](https://github.com/google-labs-code/stitch-skills/blob/main/skills/design-md/SKILL.md)
- [VoltAgent/awesome-design-md (9-section extended schema)](https://github.com/VoltAgent/awesome-design-md)
- 본 프로젝트 내부: [04-theme-system.md](./04-theme-system.md), [06-app-shell.md](./06-app-shell.md)
