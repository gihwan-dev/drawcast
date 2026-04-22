# 왜 우리는 `CLAUDE.md` / `AGENTS.md` 같은 프로젝트 전역 AI 규칙을 팀 단위로 관리해야 하는가

작성일: 2026-03-27  
대상: 개발팀 / 엔지니어링 리더 / AI 코딩 도구 도입 논의용

---

## 결론

**프로젝트 전역 AI 규칙은 팀 단위로, 저장소 안에서, 버전관리되는 문서로 운영하는 것이 맞다.**  
다만 핵심은 “모든 것을 한 문서에 몰아넣자”가 아니라, **프로젝트 공통 규칙만 팀이 관리하고 개인 취향은 개인 레이어로 분리하자**는 것이다.[^anthropic-memory][^openai-agents][^github-custom-support][^vscode-custom]

이 방식이 필요한 이유는 단순하다.

1. AI 코딩 도구들은 작업을 시작하기 전에 이런 규칙 파일을 **자동으로 읽고** 응답과 코드 변경에 반영한다.  
2. 따라서 규칙이 개인 프롬프트나 로컬 메모에만 있으면, 같은 저장소를 다뤄도 사람마다 AI가 다르게 행동한다.  
3. 반대로 규칙을 팀 문서로 두면, **일관성·재현성·리뷰 가능성·지식 전수**가 생긴다.  
4. 최근 연구는 한 걸음 더 나아가, 이런 규칙 파일이 실제로 **살아 있는 설정 자산**처럼 자주 바뀌며, 제대로 관리하지 않으면 중복·불일치·과잉 지시로 오히려 품질을 해칠 수 있다고 보여준다. 그래서 더더욱 “팀이 짧고 정확하게 관리”해야 한다.[^prompt-evolution][^prompt-management][^agent-readmes][^evaluating-agents-md]

---

## 1. 이건 개인 취향이 아니라, 주요 도구들이 이미 채택한 운영 방식이다

Anthropic는 `CLAUDE.md`를 프로젝트·사용자·조직 수준으로 둘 수 있는 **지속적 instruction 파일**로 설명한다. 특히 프로젝트용 `CLAUDE.md`에는 build/test 명령, 코딩 표준, 아키텍처 결정, 네이밍 규칙, 공통 워크플로처럼 **프로젝트에 참여하는 누구에게나 적용되는 내용**을 넣고, 이 파일은 **source control을 통해 팀과 공유**하라고 안내한다. 반면 개인 취향은 사용자 수준 파일에 두라고 분리한다.[^anthropic-memory]

OpenAI Codex도 같은 방향이다. Codex는 `AGENTS.md`를 **작업 전에 읽는 프로젝트 지침 파일**로 정의하고, 전역 지침과 프로젝트 지침, 하위 디렉터리 override를 계층적으로 합쳐 사용한다고 문서화한다. OpenAI의 표현을 빌리면, 이렇게 하면 각 작업을 **consistent expectations**로 시작할 수 있다.[^openai-agents]

GitHub Copilot과 VS Code도 repository-wide, path-specific, organization-level instruction 파일을 공식 지원한다. GitHub는 Copilot coding agent가 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`를 agent instructions로 지원한다고 명시하고, VS Code는 프로젝트-wide 규칙을 공유할 때 **file-based instructions**를 사용하라고 안내한다. 더 나아가 VS Code는 settings 기반 코드 생성/테스트 지침을 deprecated 처리하고, file-based instructions 사용을 권장한다.[^github-custom-support][^github-repo-instructions][^vscode-custom]

즉, **“AI 규칙을 파일로 두고, 팀이 함께 관리한다”는 방식은 이미 도구 생태계의 표준 방향에 가깝다.**

---

## 2. 왜 반드시 “팀 단위”로 관리해야 하는가

### 2.1 결과의 일관성과 재현성을 확보하기 위해

AI 에이전트는 같은 저장소를 다루더라도 어떤 규칙을 먼저 읽었는지에 따라 행동이 달라진다. Anthropic는 `CLAUDE.md`가 모든 세션 시작 시 로드된다고 설명하고, OpenAI는 `AGENTS.md`를 읽고 작업을 시작한다고 밝힌다. GitHub와 VS Code도 저장소 instruction 파일이 저장되면 이후 요청에 자동으로 적용된다고 문서화한다.[^anthropic-memory][^openai-agents][^github-repo-instructions][^vscode-custom]

이 말은 곧, 규칙이 팀 문서가 아니면 **개인마다 다른 숨은 프롬프트 체인**이 생긴다는 뜻이다. 그러면 같은 프로젝트에서도 누군가의 AI는 테스트를 돌리고, 누군가의 AI는 건너뛰고, 누군가는 특정 아키텍처 규칙을 지키고, 누군가는 모르고 넘어간다. 팀 단위 문서는 이 차이를 줄여 준다.[^anthropic-memory][^openai-agents]

### 2.2 규칙을 “검토 가능한 자산”으로 만들기 위해

프로젝트용 `CLAUDE.md`는 version control을 통해 팀과 공유하라고 Anthropic가 명시한다. OpenAI도 Codex가 어떤 instruction source를 읽었는지 확인할 수 있도록 안내하며, 활성 instruction source를 점검하는 방법과 로그 위치를 제공한다.[^anthropic-memory][^openai-agents]

즉, 규칙이 저장소 안에 있으면 변경 이력, 코드 리뷰, owner 지정, 회귀 확인이 가능하다. 반대로 규칙이 개인 메모나 로컬 프롬프트에만 있으면 “왜 이번엔 AI가 이렇게 행동했는가”를 설명하거나 재현하기 어렵다. **팀 단위 관리의 핵심은 통제가 아니라 추적 가능성**이다.[^anthropic-memory][^openai-agents]

### 2.3 반복 프롬프트를 줄이고 온보딩을 쉽게 하기 위해

이런 파일의 가장 큰 실무적 가치는, 매 세션마다 같은 배경 설명을 다시 하지 않아도 된다는 점이다. VS Code는 custom instructions가 매번 프롬프트에 수동으로 같은 맥락을 넣지 않아도 프로젝트 요구사항과 코딩 관행에 맞는 응답을 만들게 해 준다고 설명한다. 최근 연구도 agent context files가 프로젝트별 아키텍처, 테스트 명령, 코딩 관례를 문서화함으로써 같은 규칙을 반복 설명하는 비용을 줄여 준다고 해석한다.[^vscode-custom][^agent-readmes]

새로 합류한 팀원에게도 효과는 같다. 좋은 팀 문서는 “사람을 위한 README”의 보조 수단이 아니라, **AI가 즉시 실행 가능한 형태의 프로젝트 계약서** 역할을 한다.[^github-repo-instructions][^agent-readmes]

### 2.4 여러 AI 도구를 함께 쓰는 환경에서 기준점을 만들기 위해

현실의 팀은 Claude Code만 쓰지 않고, Copilot, Codex, VS Code, IDE 내장 에이전트 등을 함께 쓰는 경우가 많다. GitHub는 Copilot coding agent가 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`를 읽을 수 있다고 명시하고, VS Code 역시 `AGENTS.md`와 `CLAUDE.md`를 자동 감지한다. Anthropic는 기존 `AGENTS.md`를 쓰고 있다면 `CLAUDE.md`에서 이를 import해 두 도구가 같은 instruction을 읽게 만들라고 안내한다.[^github-custom-support][^vscode-custom][^anthropic-memory]

따라서 팀 단위 파일은 특정 벤더에 종속되는 장치라기보다, 오히려 **멀티툴 환경에서 기준점을 제공하는 공통 인터페이스**에 가깝다.

---

## 3. 최근 연구가 말하는 것: “팀이 관리해야 하지만, 짧고 최소한이어야 한다”

이 주제에서 중요한 점은, 연구가 단순히 “문서를 두면 좋다”에서 멈추지 않는다는 것이다. **문서는 팀이 관리해야 하지만, 길고 중복된 규칙은 오히려 해롭다**는 신호가 함께 나온다.

### 3.1 프롬프트와 규칙은 이미 소프트웨어 자산처럼 진화하고 있다

Tafreshipour 외 연구(accepted at MSR 2025)는 243개 GitHub 저장소에서 1,262개의 prompt 변경을 분석했다. 이 연구는 prompt 변경이 주로 기능 개발과 함께 이뤄지고, **단 21.9%만 commit message에 문서화**되어 있으며, prompt 변경이 논리 불일치나 LLM 응답 misalignment를 유발할 수 있다고 보고했다. 연구진은 더 나은 문서화와 검증 체계가 필요하다고 결론 내린다.[^prompt-evolution]

즉, AI 규칙은 “그때그때 알아서 쓰는 메모”가 아니라, 실제로는 코드와 함께 진화하는 **변경 대상**이다. 그렇다면 팀 단위 버전관리가 맞다.[^prompt-evolution]

### 3.2 실제 저장소의 프롬프트 관리 품질은 생각보다 들쭉날쭉하다

Li 외 연구(IEEE Software)는 92개 GitHub 저장소의 24,800개 프롬프트를 분석해, 형식 불일치, 중복, 가독성 저하, 철자 오류 같은 문제를 확인했다. 연구는 promptware에서 organization과 quality assurance가 중요하지만 쉽지 않다고 지적하며, best practices가 필요하다고 강조한다.[^prompt-management]

이 결과는 매우 실무적이다. **팀 규칙을 개인별로 흩어 두면 품질이 흔들리기 쉽다.** 반대로 저장소 안의 한 문서로 관리하면, 중복 제거와 정기 정비가 가능해진다.[^prompt-management]

### 3.3 Agent context files는 정적 문서가 아니라 “설정 코드”처럼 관리된다

Chatlatanagulchai 외 연구는 1,925개 저장소의 2,303개 agent context file을 분석했다. 이 연구에 따르면 이런 파일들은 정적 문서가 아니라 **configuration code처럼 자주 갱신되는 living artifact**이며, 59%~67%가 여러 커밋에서 반복 수정됐다. 내용 측면에서는 Build/Run, Implementation Details, Architecture 비중이 높았고, Security와 Performance 같은 비기능 요구사항은 상대적으로 적게 다뤄졌다.[^agent-readmes]

이 연구가 주는 메시지는 두 가지다.

- 첫째, 이 파일은 어차피 팀이 계속 손봐야 하는 자산이다. 그렇다면 처음부터 팀 소유로 두는 편이 맞다.  
- 둘째, 규칙 문서도 빈틈이 생기기 쉽다. 특히 보안·성능·데이터 취급 같은 고위험 가드레일은 의식적으로 넣어야 한다.[^agent-readmes]

### 3.4 하지만 “많이 쓰는 것”은 답이 아니다

2026년 preprint인 *Evaluating AGENTS.md*는 매우 중요한 반론을 제기한다. 이 연구는 여러 코딩 에이전트와 벤치마크에서 context files가 **성공률을 낮추고 추론 비용을 20% 이상 높일 수 있다**고 보고한다. 특히 agent들은 이런 파일의 지시를 실제로 잘 따르기 때문에, **불필요한 요구사항**이 많을수록 작업이 어려워질 수 있다고 결론 내린다. 저자들은 인간이 쓴 context file이라도 **minimal requirements**만 남겨야 한다고 제안한다.[^evaluating-agents-md]

이 결과는 “팀 단위 관리가 필요 없다”는 근거가 아니라, 오히려 **팀이 엄격하게 범위를 관리해야 한다**는 근거다.  
정리하면 다음과 같다.

- 문서를 두는 것은 맞다.  
- 하지만 루트 문서는 짧고 정확해야 한다.  
- 에이전트가 코드에서 스스로 추론할 수 있는 내용, README에 이미 잘 정리된 내용, 자동 생성된 중복 설명은 줄여야 한다.  
- 남겨야 할 것은 **비용이 큰 실수 방지 규칙**과 **프로젝트 고유의 비자명한 제약**이다.[^evaluating-agents-md][^anthropic-memory][^vscode-custom]

---

## 4. 흔한 반대 의견과 답변

### 반대 1. “이건 개인 작업 방식까지 통제하려는 것이다”

그럴 필요가 없다. 오히려 공식 문서들은 **개인 지침과 프로젝트 지침을 분리**하라고 설계돼 있다. Anthropic는 project `CLAUDE.md`에는 project-level standards를 두고, 개인 취향은 user-level 파일에 두라고 설명한다. GitHub와 VS Code도 personal / repository / organization instruction 레이어를 지원한다.[^anthropic-memory][^github-custom-support][^vscode-custom]

따라서 팀 문서의 범위는 아래처럼 제한하면 된다.

- **팀 문서에 넣을 것:** build/test/lint 명령, 아키텍처 불변식, 네이밍 규칙, 보안·컴플라이언스 경계, PR 전 점검, 모듈별 금지사항  
- **개인 문서에 둘 것:** 말투, 선호하는 설명 방식, 개인 에디터 습관, 개인 alias, 개인 선호 라이브러리 순위

즉, 이것은 개인성 억압이 아니라 **공통 작업계약의 명문화**다.

### 반대 2. “README나 CONTRIBUTING으로도 충분하다”

README와 CONTRIBUTING은 계속 필요하다. 다만 AI 도구 입장에서는, 이런 문서가 있어도 매번 알아서 찾아 읽고 우선순위를 맞춰 해석해야 한다. 반면 instruction 파일은 **도구가 자동으로 로드하는, 항상 적용되는 규칙 레이어**다.[^github-repo-instructions][^vscode-custom]

또한 Anthropic는 이미 `CLAUDE.md`에서 `@AGENTS.md`를 import해 **중복 없이 한 소스만 유지**하는 방식을 안내한다. 즉, 핵심은 문서를 늘리는 것이 아니라 **사람용 문서와 AI용 규칙의 역할을 분리하고, 가능하면 같은 원본을 참조하게 만드는 것**이다.[^anthropic-memory]

### 반대 3. “문서가 금방 커지고 낡을 것이다”

이 우려는 맞다. 최근 연구도 과도한 context file이 성능을 떨어뜨릴 수 있다고 지적한다. 그래서 답은 “안 만든다”가 아니라, **짧고 최소한으로 관리한다**다. Anthropic는 instructions가 구체적이고 간결할수록 더 일관되게 따른다고 설명하고, VS Code도 concise and focused한 문서를 권장한다. OpenAI 역시 파일이 커지면 nested directories로 나누라고 안내한다.[^anthropic-memory][^openai-agents][^vscode-custom]

### 반대 4. “도구가 바뀌면 이 규칙은 무용지물이다”

오히려 반대다. 주요 도구들은 서로 다른 이름의 instruction 파일을 지원하지만, 개념 자체는 매우 유사하다. GitHub Copilot coding agent는 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`를 지원하고, VS Code는 `AGENTS.md`, `CLAUDE.md`, `.instructions.md`, `.github/copilot-instructions.md`를 모두 감지한다. Anthropic는 `AGENTS.md`를 `CLAUDE.md`에서 import하는 방식을 공식 문서에 포함하고 있다.[^github-custom-support][^vscode-custom][^anthropic-memory]

즉, 도구가 달라져도 버려지는 것이 아니라, **파일 이름과 연결 방식만 약간 달라질 뿐 같은 자산을 재사용**할 가능성이 높다.

---

## 5. 우리 팀에 권장하는 운영 원칙

### 원칙 1. 루트에는 “프로젝트 공통 규칙”만 둔다

루트 `CLAUDE.md` 또는 `AGENTS.md`에는 아래 정도만 둔다.

- 공식 build / test / lint / format 명령  
- 변경 전에 반드시 확인할 아키텍처 불변식  
- 네이밍 / 코드 스타일의 핵심 원칙  
- 보안·데이터 처리·권한 관련 금지사항  
- PR 전 체크리스트  
- “이 프로젝트에서 특히 자주 틀리는 것” 같은 비자명한 landmine

여기서 중요한 기준은 하나다.  
**에이전트가 코드만 보고는 쉽게 알 수 없거나, 틀렸을 때 비용이 큰 정보만 넣는다.**[^evaluating-agents-md][^anthropic-memory][^vscode-custom]

### 원칙 2. 개인 취향은 개인 레이어로 분리한다

Anthropic는 `~/.claude/CLAUDE.md` 같은 user instruction을, VS Code는 user profile instructions와 `CLAUDE.local.md` 같은 로컬 변형을 지원한다. 이 레이어는 개인 선호를 담는 곳이고, 저장소의 팀 문서와 섞지 않는 것이 좋다.[^anthropic-memory][^vscode-custom]

### 원칙 3. 예외는 하위 디렉터리 규칙으로 내린다

OpenAI Codex는 nested `AGENTS.override.md`를, GitHub Copilot과 VS Code는 path-specific instruction 파일을, Anthropic는 `.claude/rules/`와 하위 디렉터리 `CLAUDE.md`/rules를 지원한다. 도메인별 예외가 많은 모노레포라면, 루트 문서를 키우기보다 **가까운 위치에 좁은 규칙**을 두는 편이 맞다.[^anthropic-memory][^openai-agents][^github-repo-instructions][^vscode-custom]

### 원칙 4. 규칙 파일도 코드처럼 리뷰한다

최근 연구는 prompt와 context file이 실제로 자주 변하고, 문서화가 부족하고, 중복과 불일치가 생기기 쉽다는 점을 보여준다. 따라서 규칙 파일 변경은 일반 코드와 마찬가지로 PR에서 검토하고, 변경 이유를 남기고, 소유자를 두는 것이 바람직하다.[^prompt-evolution][^prompt-management][^agent-readmes]

### 원칙 5. 하나의 canonical source를 정한다

여러 도구를 같이 쓰는 팀이라면, **공통 본문을 하나의 파일에서 관리**하는 것이 유지보수에 유리하다. 예를 들어 `AGENTS.md`를 canonical source로 두고, Claude를 위해 루트 `CLAUDE.md`에서 `@AGENTS.md`를 import하는 식으로 구성할 수 있다. 이 방식은 Anthropic 공식 문서가 직접 안내한다.[^anthropic-memory]

---

## 6. 제안하는 최소 도입안

가장 현실적인 시작안은 아래와 같다.

1. 저장소 루트에 팀 소유의 instruction 파일을 만든다.  
2. 문서 길이는 처음부터 짧게 유지한다.  
3. 내용은 “모든 팀원이 반드시 공유해야 하는 것”만 적는다.  
4. 개인 취향은 사용자/로컬 instruction으로 분리한다.  
5. 폴더별 예외는 하위 규칙으로 내린다.  
6. 규칙 파일 변경도 PR 리뷰 대상으로 포함한다.

한 문장으로 요약하면,

> **이건 팀원을 통제하자는 게 아니라, AI가 읽는 프로젝트 운영계약을 저장소 안에 두고 같이 개선하자는 제안이다.**

---

## 7. 최종 제안 문구

아래 문장을 그대로 내부 문서나 회의 안건으로 써도 된다.

> 우리는 `CLAUDE.md` / `AGENTS.md` 같은 프로젝트 전역 AI 규칙을 팀 단위로 관리한다. 이유는 AI 코딩 도구들이 이 파일을 자동으로 읽고 행동하기 때문에, 이를 개인 프롬프트에 맡기면 결과가 사람마다 달라지기 때문이다. 팀 문서로 두면 일관성, 재현성, 온보딩, 리뷰 가능성이 생긴다. 다만 루트 문서는 짧고 최소한이어야 하며, 프로젝트 공통 규칙만 담고, 개인 취향은 개인 레이어로 분리한다. 예외가 필요한 영역은 하위 디렉터리 규칙으로 나눈다. 즉, 목표는 문서를 늘리는 것이 아니라 AI가 읽는 공통 작업계약을 버전관리하는 것이다.

---

## 참고 자료

### 공식 문서

[^anthropic-memory]: Anthropic, **How Claude remembers your project**. `CLAUDE.md`의 project/user/org scope, source control 공유, `AGENTS.md` import, `.claude/rules/`, large teams 운영 방식 등을 설명. <https://code.claude.com/docs/en/memory>

[^openai-agents]: OpenAI, **Custom instructions with AGENTS.md**. Codex의 `AGENTS.md` 계층, repo-level instructions, nested override, active instruction source 확인 방법을 설명. <https://developers.openai.com/codex/guides/agents-md/>

[^github-repo-instructions]: GitHub Docs, **Adding repository custom instructions for GitHub Copilot**. repository-wide / path-specific instructions와 자동 적용 방식을 설명. <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>

[^github-custom-support]: GitHub Docs, **Support for different types of custom instructions**. personal, repository-wide, path-specific, agent instructions(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), organization instructions 지원 범위를 정리. <https://docs.github.com/en/copilot/reference/custom-instructions-support>

[^vscode-custom]: Visual Studio Code Docs, **Use custom instructions in VS Code**. `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.instructions.md`, organization-level instructions, file-based instructions 권장, settings-based instructions deprecation을 설명. <https://code.visualstudio.com/docs/copilot/customization/custom-instructions>

### 연구

[^prompt-evolution]: Mahan Tafreshipour, Aaron Imani, Eric Huang, Eduardo Almeida, Thomas Zimmermann, Iftekhar Ahmed, **Prompting in the Wild: An Empirical Study of Prompt Evolution in Software Repositories** (accepted at MSR 2025). arXiv:2412.17298. <https://arxiv.org/abs/2412.17298>

[^prompt-management]: Hao Li, Hicham Masri, Filipe R. Cogo, Abdul Ali Bangash, Bram Adams, Ahmed E. Hassan, **Understanding Prompt Management in GitHub Repositories: A Call for Best Practices** (IEEE Software, 2025; DOI linked from arXiv). arXiv:2509.12421. <https://arxiv.org/abs/2509.12421>

[^agent-readmes]: Worawalan Chatlatanagulchai, Hao Li, Yutaro Kashiwa, Brittany Reid, Kundjanasith Thonglek, Pattara Leelaprute, Arnon Rungsawang, Bundit Manaskasemsak, Bram Adams, Ahmed E. Hassan, Hajimu Iida, **Agent READMEs: An Empirical Study of Context Files for Agentic Coding** (2025 preprint). arXiv:2511.12884. <https://arxiv.org/abs/2511.12884>

[^evaluating-agents-md]: Thibaud Gloaguen, Niels Mündler, Mark Müller, Veselin Raychev, Martin Vechev, **Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?** (2026 preprint). arXiv:2602.11988. <https://arxiv.org/abs/2602.11988>
