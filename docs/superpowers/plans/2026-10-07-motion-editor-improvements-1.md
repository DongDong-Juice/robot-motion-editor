# 모션 편집기 개선 1 Implementation Plan

> **상태 (2026-10-12):** 완료 · `master` 머지됨. 아래 체크박스는 작업 중 갱신하지 않았음 — 진행 기록은 git 이력을 볼 것.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장 파일 축소(v2), 키 줄이기, 크로스페이드 구간 인스펙터 잠금, 트랙 숨김·잠금, 패널 크기 조절.

**Architecture:** 기존 모듈 안에서 국소 변경. 파일 형식은 `projectFile.ts`에서만 v1/v2를 다루고 메모리 모델(`Project`)은 그대로. 키 줄이기는 순수 함수 + 스토어 액션 1개. 편집 차단 규칙은 스토어의 `gizmoLock`과 새 `trackLocked` 두 곳에서만 결정하고 UI는 그 결과만 따른다.

**Tech Stack:** 기존과 동일. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-07-robot-motion-editor-design.md` (3절 트랙 👁🔒·패널 크기 조절, 범위 표의 "키 감소"). 설계는 대화에서 승인(2026-10-07).

## Global Constraints

- M1–M3 제약 전부 유지 (60fps, CSV 형식, 의존성 4개, 파일 API는 `fileio.ts`만, `edit(fn, touched)` 채널 선언·dev freeze, `tryEdit`, 프로젝트 변경 = dirty, 토큰·서체·금지 스타일, 한국어 문구).
- 프로젝트 파일: 저장은 항상 `version: 2`, 열기는 1과 2 모두. 메모리의 `Project.version`은 2.
- 키 줄이기 기본 허용 오차: 관절·루트 회전 0.001 rad, 루트 위치 0.001 m. 결과 키는 전부 `linear`. 원 커브 대비 매 정수 프레임 최대 오차 ≤ 허용 오차.
- 숨김 트랙: 무대·궤적에서만 감춤. CSV 내보내기·검증에는 포함.
- 잠금 트랙: 그 트랙 Item 편집과 그 액터의 키 편집 전부 거부. 선택·재생·내보내기는 허용.

## Review Focus

1. v1 파일(M3 이전 저장본) 열기 → v2로 저장 → 다시 열기: 프로젝트 동일 (Task 1).
2. 키 줄이기 후 CSV 내보내기 값이 원본과 허용 오차 이내, 첫·끝 키 유지 (Task 2).
3. 잠금 트랙에 대해 모든 편집 경로(기즈모, 인스펙터, 타임라인 키, 시퀀스 드래그·트림·C·Delete·드롭, keyGroup, 붙여넣기, 키 줄이기) 거부 (Task 4).
4. 크로스페이드 구간에서 인스펙터 편집이 블렌드 값을 뒤 클립에 쓰지 않음 (Task 3).
5. 패널을 최소 크기로 줄여도 three 렌더러·캔버스가 0px로 깨지지 않음 (Task 5).

---

### Task 1: 프로젝트 파일 v2 (압축 키 배열)

**Files:** Modify `src/model/projectFile.ts`, `src/model/types.ts`(version 1|2), `src/model/defaults.ts`; Test `src/model/projectFile.test.ts`

**Interfaces:**
- `serializeProject(p): string` → `JSON.stringify` 들여쓰기 없음, `version: 2`, 각 커브 `{ k: number[] }` (키당 7개: f, v, interp(0 linear·1 bezier·2 hold), inTan.df, inTan.dv, outTan.df, outTan.dv), 실수는 소수 6자리 반올림(정수는 그대로).
- `parseProject(text, defs)`: `version` 1이면 기존 경로, 2이면 `k` 배열 길이 7의 배수·모든 값 유한수·interp 코드 0..2·f 정수 엄격 증가 검사 후 `Key[]`로 복원. 그 외 버전은 기존 메시지.
- 메모리 `Project.version`은 2 (`newProject`, `loadProject` 결과 모두).

- [ ] Step 1: 실패 테스트 — v2 왕복 동일(소수 6자리 이내), v1 문자열(기존 fixture) 열기 성공 후 v2 저장, 5000×36 키 프로젝트의 v2 크기 < v1(들여쓰기 1) 크기의 30%, 잘못된 k(길이 8, NaN, interp 3, f 비증가) 거부.
- [ ] Step 2: FAIL. Step 3: 구현. Step 4: `npx vitest run`, `npx tsc -b`, `npm run e2e` PASS.
- [ ] Step 5: Commit `feat(file): compact project format v2 (reads v1)`.

---

### Task 2: 키 줄이기

**Files:** Create `src/model/simplify.ts`, `src/model/simplify.test.ts`; Modify `src/store/store.ts`, `src/inspector/Inspector.tsx`, `src/project/ProjectPanel.tsx`(가져오기 대화상자)

**Interfaces:**
- `simplifyCurve(c: Curve, tol: number): Curve` — 정수 프레임에서 원 커브를 샘플(첫 키 f..마지막 키 f), RDP로 점 선택, 결과 키 `linear`(탄젠트 기본값), 결과를 다시 샘플해 최대 오차 > tol 이면 그 구간에 점을 추가하며 반복. 키 0·1개는 그대로.
- `simplifyTolerance(channel: string, rot: number, pos: number): number` — `root.x/y/z` → pos, 그 외 rot.
- store `simplifyClip(clipId: string, rot = 0.001, pos = 0.001): number` — 클립 전 채널 단순화, undo 1개, `touched: 'all'`, 반환 = 줄어든 키 수. 잠긴 트랙의 액터 클립이면 0 반환(무변경) — Task 4 이후 동작, 이 Task에서는 잠금 검사 자리만 `trackLocked` 없이 둠.
- Inspector 클립 영역: "키 줄이기" 버튼 + "허용 오차" 숫자 입력(rad, 기본 0.001; 위치도 같은 값을 m로 사용) → 결과 문구 "키 N개를 줄였습니다" 3초.
- CSV 가져오기 대화상자: 체크박스 "가져올 때 키 줄이기"(기본 켜짐) → 가져온 각 클립에 `simplifyCurve` 적용 후 `importClip`.

- [ ] Step 1: 실패 테스트 — 직선 1000키 → 2키, 사인 600키 tol 0.001 → 줄어들고 최대 오차 ≤ 0.001, 첫·끝 키 유지, hold/bezier 원본도 샘플 기준 오차 ≤ tol, 스토어 undo 1개·반환 개수.
- [ ] Step 2: FAIL → 구현 → PASS. Step 3: 브라우저: 5000프레임 CSV 가져오기(체크 켜짐) → 키 수 감소, 내보낸 CSV가 원 CSV와 열별 최대 오차 ≤ 0.001.
- [ ] Step 4: Commit `feat(edit): simplify curves (RDP with error guard), on import and per clip`.

---

### Task 3: 크로스페이드 구간 인스펙터 잠금

**Files:** Modify `src/inspector/Inspector.tsx`, `src/store/store.ts`

**Interfaces:**
- `gizmoLock(state)`를 인스펙터가 사용: 결과가 `'crossfade'`이면 슬라이더·숫자 입력·키 추가·키 삭제·보간 변경·그룹 전체 키 비활성 + 문구 "크로스페이드 구간에서는 클립 보기에서 편집하세요". `'stitch'`이면 루트 x·y·yaw 입력만 비활성 + 기존 stitch 문구.
- store `setValue`/`keyGroup`도 같은 규칙으로 거부(UI 우회 방지) — 관절은 crossfade일 때, 루트 x·y·yaw는 stitch일 때.
- 무대 크로스페이드 문구를 채널 종류와 무관한 위 문구로 통일.

- [ ] Step 1: 실패 테스트 — 겹침 구간 시퀀스 보기에서 `setValue`(관절)·`keyGroup` 무변경, 클립 보기에서는 허용; stitch 프레임에서 `setValue('root.x')` 무변경, `root.z` 허용.
- [ ] Step 2: FAIL → 구현 → PASS. Step 3: 브라우저: 겹침 구간에서 인스펙터 비활성·문구.
- [ ] Step 4: Commit `fix(edit): lock inspector edits in crossfade/stitch frames`.

---

### Task 4: 트랙 숨김·잠금

**Files:** Modify `src/store/store.ts`, `src/timeline/SequenceCanvas.tsx`, `src/viewer/Stage.tsx`, `src/inspector/Inspector.tsx`, `src/timeline/TrackCanvas.tsx`, `src/timeline/GraphCanvas.tsx`, `src/transport.ts`

**Interfaces:**
- store: `setTrackFlag(trackId: string, flag: 'hidden' | 'locked', on: boolean): void` (undo 1개, dirty).
- `trackLocked(p: Project, actorId: string): boolean` (export) — 그 액터 모션 트랙의 `locked`.
- 잠금 거부(무변경, false/무시): `addItem`·`moveItem`·`trimItem`·`splitItem`·`deleteItem`·`addVideoItem`(대상 트랙 locked), `setKey`·`deleteKeys`·`moveKeys`·`setInterp`·`setTangent`·`setValue`·`keyGroup`·`simplifyClip`(클립을 참조하는 Item이 잠긴 트랙에 하나라도 있으면). 기존 `tryEdit` 경로 활용.
- SequenceCanvas 라벨 열: 눈·자물쇠 아이콘(캔버스 path로 그림, 14px, 꺼짐 = `--line`, 켜짐 = `--text`/`--accent`), 클릭 = `setTrackFlag`. 잠긴 트랙 막대는 사선 없이 50% 투명. 숨긴 트랙 라벨은 흐리게.
- Stage: 숨긴 액터 rig·궤적·점 `visible = false`, 선택 불가.
- Inspector/TrackCanvas/GraphCanvas: 잠긴 액터면 편집 컨트롤 비활성 + 문구 "잠긴 트랙입니다".
- 실패한 드래그·드롭 문구: "잠긴 트랙입니다".

- [ ] Step 1: 실패 테스트 — Review Focus 3의 액션 목록 각각 잠금 시 무변경(한 테스트에서 표로 순회), 숨김은 `evaluate`·CSV에 영향 없음, 플래그 undo.
- [ ] Step 2: FAIL → 구현 → PASS. Step 3: 브라우저: 아이콘 클릭, 숨김 시 무대에서 사라짐, 잠금 시 드래그·기즈모·인스펙터 거부 문구.
- [ ] Step 4: Commit `feat(timeline): track hide/lock`.

---

### Task 5: 패널 크기 조절

**Files:** Create `src/layout/useLayout.ts`, `src/layout/useLayout.test.ts`; Modify `src/App.tsx`, `src/styles.css`

**Interfaces:**
- `interface Layout { left: number; right: number; bottom: number }` (px; 기본 220, 280, 화면 높이의 40%)
- `clampLayout(l: Layout, w: number, h: number): Layout` — left ∈ [160, 480], right ∈ [220, 520], bottom ∈ [160, h − 32 − 200], 무대 최소 폭 320 보장(넘치면 left·right를 비율로 줄임).
- `useLayout(): [Layout, (patch: Partial<Layout>) => void, () => void]` — localStorage 키 `motion-editor.layout`(try/catch), 창 크기 변경 시 재클램프, 세 번째 = 기본값 복원.
- App: grid 템플릿을 상태로; 경계 3개에 6px 드래그 핸들(`role="separator"`, `aria-orientation`, 키보드 ←/→/↑/↓ 16px 이동), 더블클릭 = 기본값. 드래그 중 `cursor` 고정·텍스트 선택 방지.

- [ ] Step 1: 실패 테스트 — `clampLayout` 경계·무대 최소 폭·작은 창.
- [ ] Step 2: FAIL → 구현 → PASS. Step 3: 브라우저: 각 핸들 드래그, 새로고침 후 유지, 더블클릭 복원, 최소 크기에서 3D·타임라인 캔버스 폭 > 0.
- [ ] Step 4: `npx vitest run`, `npx tsc -b`, `npm run build`, `npm run e2e` PASS.
- [ ] Step 5: Commit `feat(layout): resizable panels`.
