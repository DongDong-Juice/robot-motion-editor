# 무대 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D 프리뷰에 무대(바닥·격자·테두리)와 객석(+X) 표시를 그리고, 창마다 `무대` 버튼으로 켜고 끄며, 크기는 인스펙터에서 바꿔 프로젝트에 저장한다.

**Architecture:** 크기는 `Project.stage`(선택 필드) + 스토어 `setStage`(실행취소 1회). 그리기는 순수 three.js 함수 `makeStage(w, d)`(새 파일)를 `Stage.tsx`가 크기 변경 시 다시 만들어 붙이고, 켜짐 상태는 메인 창 = 스토어 `stageShown`, 다른 창 = 로컬 state. 인스펙터 맨 아래 `StageSection`.

**Tech Stack:** React 19, TypeScript, three.js, zustand, vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-10-19-stage-setup-design.md`

## Global Constraints

- 객석 = 월드 **+X** 쪽, 무대 중심 = 월드 원점. `width` = 월드 Y 길이(객석에서 본 좌우), `depth` = 월드 X 길이.
- 기본 크기 `{ width: 10, depth: 6 }`, 범위 1~30 m, 소수 1자리 반올림.
- 표시 전용: 평가·CSV·물리 코드는 건드리지 않는다.
- UI 문구 한국어, 대문자 라벨 금지(`FRONT` 쓰지 않음), 그림자·그라데이션 금지. 색은 CSS 토큰(`--panel`, `--line`, `--dim`, `--accent`)을 `css()`로 읽음. 서체 IBM Plex Sans KR.
- 3D 리소스(geometry·material·texture)는 교체·언마운트 시 dispose.
- 작업 중엔 관련 테스트만 돌리고 전체 테스트는 푸시 직전에만(사용자 규칙).
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. 인스펙터 숫자 입력을 비우거나(NaN) 0·100을 넣음 → NaN은 무시, 범위 밖은 1/30으로 잘림, 입력란은 저장된 값으로 돌아옴 (Task 1 `setStage` 테스트, Task 3 e2e).
2. `stage` 필드가 없거나 깨진(`"abc"`, `{width:-1}`) 예전/손상 파일 열기 → 오류 없이 열리고 기본 10×6 (Task 1 projectFile 테스트).
3. 크기를 여러 번 바꿈 → 이전 무대 그룹이 장면에서 빠짐(누적 안 됨) (Task 2 단위 테스트는 그룹 구성만, Task 3 e2e에서 장면 안 무대 그룹이 1개인지 확인).
4. 메인 창에서 무대를 꺼도 클립 프리뷰 창의 무대는 그대로 (Task 3 e2e).
5. 로봇 선택 없음 / 클립 편집 모드에서도 인스펙터 `무대` 섹션 보임 (Task 3 e2e: 선택 없이 확인).

---

### Task 1: 무대 크기 데이터 (모델·스토어·파일)

**Files:**
- Modify: `src/model/types.ts` (`Project`에 `stage?: StageSize`, `export interface StageSize { width: number; depth: number }`)
- Modify: `src/model/defaults.ts` (`STAGE_DEFAULT`, `stageOf`)
- Modify: `src/store/store.ts` (`stageShown`, `setStageShown`, `setStage`)
- Modify: `src/model/projectFile.ts:160-162` (`stage` 검증)
- Test: `src/store/store.test.ts`, `src/model/projectFile.test.ts`

**Interfaces:**
- Produces:
  - `type StageSize = { width: number; depth: number }` (`model/types`)
  - `STAGE_DEFAULT: StageSize = { width: 10, depth: 6 }`, `stageOf(p: Project): StageSize` (`model/defaults`) — 필드 없으면 기본값
  - 스토어: `stageShown: boolean`(기본 `true`, 저장 안 함), `setStageShown(on: boolean): void`, `setStage(patch: Partial<StageSize>): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/store/store.test.ts`:
```ts
test('setStage: rounds to 0.1, clamps to 1..30, ignores NaN, one undo step', () => {
  expect(stageOf(s().project)).toEqual({ width: 10, depth: 6 })
  s().setStage({ width: 12.345 })
  expect(s().project.stage).toEqual({ width: 12.3, depth: 6 })
  s().setStage({ width: 0, depth: 100 })
  expect(s().project.stage).toEqual({ width: 1, depth: 30 })
  const before = s().project
  s().setStage({ width: NaN })
  expect(s().project).toBe(before)
  s().undo()
  expect(s().project.stage).toEqual({ width: 12.3, depth: 6 })
})
test('stageShown defaults on and toggles', () => {
  expect(s().stageShown).toBe(true)
  s().setStageShown(false)
  expect(s().stageShown).toBe(false)
})
```
`src/model/projectFile.test.ts` (기존 physics 테스트와 같은 모양):
```ts
test('stage round-trips; absent stays absent; malformed is dropped', () => {
  // p = 기존 테스트처럼 emptyProject 기반
  expect('stage' in parseProject(serializeProject(p), defs)).toBe(false)
  p.stage = { width: 8, depth: 5 }
  expect(parseProject(serializeProject(p), defs).stage).toEqual({ width: 8, depth: 5 })
  for (const v of ['abc', null, { width: -1, depth: 5 }, { width: 8 }]) {
    const o = JSON.parse(serializeProject(p)); o.stage = v
    expect('stage' in parseProject(JSON.stringify(o), defs)).toBe(false)
  }
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/store/store.test.ts src/model/projectFile.test.ts`
Expected: FAIL (`stageOf`/`setStage` 없음, malformed `stage` 남음)

- [ ] **Step 3: 구현**

- `setStage`: 값마다 `Number.isFinite`가 아니면 무시(전부 무시면 `edit` 안 함), `Math.min(30, Math.max(1, Math.round(v * 10) / 10))`, `edit(p => { p.stage = { ...stageOf(p), ...clean } }, [])` (`setPhysics`와 같은 `touched`).
- `stageShown`/`setStageShown`: `degrees`/`setDegrees`와 같은 UI 필드 방식(`set`만, `edit` 아님).
- `parseProject`: `p.physics` 줄 옆에 — `stage`가 객체이고 `width`·`depth`가 모두 유한수이며 1~30 안이 아니면 `delete p.stage`.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/store/store.test.ts src/model/projectFile.test.ts && npx tsc -b`
Expected: PASS, 타입 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/model/types.ts src/model/defaults.ts src/store/store.ts src/model/projectFile.ts src/store/store.test.ts src/model/projectFile.test.ts
git commit -m "feat(stage): Project.stage size (default 10x6, 1-30 m) with setStage and per-session stageShown"
```

### Task 2: 무대 그리기와 `무대` 버튼

**Files:**
- Create: `src/viewer/stageFloor.ts`
- Test: `src/viewer/stageFloor.test.ts`
- Modify: `src/viewer/Stage.tsx` (격자 옆에 무대 그룹, 버튼, 훅)

**Interfaces:**
- Consumes: `stageOf`, 스토어 `stageShown`/`setStageShown` (Task 1)
- Produces:
  - `makeStage(width: number, depth: number, colors: { floor: string; line: string; edge: string; front: string }): THREE.Group` — 이름 `'stage'`, 자식 이름 `'floor'`(width×depth 평면, 중심 원점, z = −0.001), `'grid'`(0.5 m 격자, 1 m 진하게), `'edge'`(테두리), `'front'`(+X 가장자리 바깥 `x = depth/2 + 0.06`에 폭 0.12 m × 길이 width 띠), `'label'`(`객석` 글자 평면, 띠 바깥 약 0.5 m, 글자 아래쪽이 +X를 향함)
  - `disposeStage(g: THREE.Group): void` — 자식의 geometry·material·map dispose
  - 개발 훅 `__stages[key].stage(): THREE.Group | null` (보이는 무대 그룹, 꺼져 있으면 `null`)

- [ ] **Step 1: 실패하는 테스트 작성** (`src/viewer/stageFloor.test.ts`; vitest 환경은 `node`라 `document`가 없음 → `label`은 만들지 않는 경로를 타고, 테스트는 `floor`·`front`만 검사. `floor`는 `PlaneGeometry(depth, width)` = X 길이 depth, Y 길이 width)

```ts
test('makeStage: floor width×depth centred on origin, audience strip on +X', () => {
  const g = makeStage(8, 5, { floor: '#2B3038', line: '#3B424D', edge: '#8d96a3', front: '#F0A43A' })
  const box = new THREE.Box3().setFromObject(g.getObjectByName('floor')!)
  expect(box.min.x).toBeCloseTo(-2.5); expect(box.max.x).toBeCloseTo(2.5)
  expect(box.min.y).toBeCloseTo(-4); expect(box.max.y).toBeCloseTo(4)
  const f = new THREE.Box3().setFromObject(g.getObjectByName('front')!)
  expect(f.min.x).toBeGreaterThanOrEqual(2.5)
  expect(f.max.y - f.min.y).toBeCloseTo(8)
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/viewer/stageFloor.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `stageFloor.ts` 구현**

격자는 `makeGrid`처럼 한 `LineSegments`에 vertex color, 범위는 무대 안만(`x ∈ [−depth/2, depth/2]`, `y ∈ [−width/2, width/2]`, 0.5 m 간격이 나누어떨어지지 않으면 가장자리는 테두리가 맡음). `label`은 `document.createElement('canvas')`에 `600 30px "IBM Plex Sans KR"`로 `객석`, `CanvasTexture` + `MeshBasicMaterial({ transparent: true, depthWrite: false })` 평면, `document`가 없으면 만들지 않음.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/viewer/stageFloor.test.ts`
Expected: PASS

- [ ] **Step 5: `Stage.tsx` 연결**

- 상태: `const main = !cid && !span`; 메인은 `useEditor(s => s.stageShown)`과 `setStageShown`, 그 밖은 `useState(true)`. `stageRef.current = shown`(follow와 같은 ref 방식).
- 효과 안: `let stageG: THREE.Group | null = null, stageKey = ''`; `syncStage()` = `stageOf(project)`의 `width,depth` 키가 바뀌면 이전 그룹 `scene.remove` + `disposeStage` 후 `makeStage(..., { floor: css('--panel'), line: css('--line'), edge: css('--dim'), front: css('--accent') })`(빈 값이면 CLAUDE.md 색 토큰 값으로 대체) 추가. 처음에 한 번, `store.subscribe`에서 `s.project !== prev.project`일 때 호출(cid 창 포함, 반환 전에).
- 렌더 루프: `stageRef.current`가 바뀌면 `stageG.visible = on; grid.visible = !on; dirty = true` (`shownTrail` 패턴).
- 정리: `disposeStage(stageG)`.
- 훅 객체에 `stage: () => stageG?.visible ? stageG : null`.
- 버튼: `로봇 따라가기` 바로 뒤 `<button className="pv-btn" aria-pressed={shown} onClick={...} title="무대와 객석 방향을 보여 줍니다">무대</button>`.

- [ ] **Step 6: 확인**

Run: `npx tsc -b && npx playwright test e2e/follow.spec.ts e2e/webgl.spec.ts`
Expected: 타입 오류 없음, 두 e2e PASS (기존 3D 동작 회귀 없음)

- [ ] **Step 7: 커밋**

```bash
git add src/viewer/stageFloor.ts src/viewer/stageFloor.test.ts src/viewer/Stage.tsx
git commit -m "feat(stage): draw stage floor with audience (+X) mark; 무대 toggle per 3D pane, on by default"
```

### Task 3: 인스펙터 `무대` 섹션 + e2e + 문서

**Files:**
- Modify: `src/inspector/Inspector.tsx` (`StageSection` 컴포넌트, 모든 반환 경로 끝)
- Create: `e2e/stage.spec.ts`
- Modify: `CLAUDE.md` (핵심 불변식에 한 줄)

**Interfaces:**
- Consumes: `stageOf`, `setStage`, `stageShown` (Task 1); `__stage.stage()`, `무대` 버튼 (Task 2)

- [ ] **Step 1: 실패하는 e2e 작성** (`e2e/stage.spec.ts`, `follow.spec.ts`의 시작 방식)

```ts
test('무대: on by default, size from the inspector, off hides stage and section', async ({ page }) => {
  // goto('/'), #stage canvas 보일 때까지; 로봇 선택 없음 상태 유지
  const pane = page.getByRole('region', { name: '로봇 프리뷰' })
  const btn = pane.getByRole('button', { name: '무대', exact: true })
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  const w = page.getByRole('spinbutton', { name: '무대 가로' }), d = page.getByRole('spinbutton', { name: '무대 깊이' })
  await expect(w).toHaveValue('10'); await expect(d).toHaveValue('6')
  await d.fill('4'); await d.blur()
  const size = () => page.evaluate(() => {
    const p = (window as any).__stage.stage()?.getObjectByName('floor').geometry.parameters
    return p ? [p.width, p.height] : null })
  await expect.poll(size).toEqual([4, 10])   // PlaneGeometry(depth(X), width(Y))
  await w.fill('100'); await w.blur(); await expect(w).toHaveValue('30')
  await w.fill(''); await w.blur(); await expect(w).toHaveValue('30')
  // 크기를 바꿔도 장면의 무대 그룹은 하나
  expect(await page.evaluate(() => (window as any).__stage.stage().parent.children.filter((c: any) => c.name === 'stage').length)).toBe(1)
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  await expect(w).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__stage.stage())).toBeNull()
})
```
클립 프리뷰 창 독립성: 같은 파일에 두 번째 테스트 — 조각을 열어 클립 프리뷰를 띄운 뒤(`openItemPreview(id, true)`), 메인 `무대`를 끄고 `__stages.preview.stage()`가 null이 아님을 확인.

- [ ] **Step 2: 실패 확인**

Run: `npx playwright test e2e/stage.spec.ts`
Expected: FAIL (`무대 가로` 입력 없음)

- [ ] **Step 3: `StageSection` 구현**

`stageShown`이 false면 `null`. `<section className="insp-sec"><h3 className="insp-sec-t">무대</h3>` + `insp-grid3` 안에 `가로`·`깊이` `insp-field`(배치 섹션과 같은 마크업, `aria-label="무대 가로"`/`"무대 깊이"`, `min 1 max 30 step 0.1`, 단위 `m`) — 입력 중 바로 쓰지 않고 `key={값}` + `defaultValue` + `onBlur`/Enter에 `setStage`, 이후 `e.target.value`를 저장된 값으로 되돌림(클립 길이 입력과 같은 방식). 아래 `<p className="insp-hint">객석은 +X 쪽입니다</p>`. 인스펙터의 세 반환 경로(로봇 없음, 클립 없음, 일반)에 모두 붙인다 — 안내문만 있던 경로는 `<>{안내}<StageSection /></>`.

- [ ] **Step 4: 통과 확인**

Run: `npx tsc -b && npx playwright test e2e/stage.spec.ts e2e/clipEdit.spec.ts`
Expected: PASS

- [ ] **Step 5: CLAUDE.md 갱신** — 핵심 불변식 목록에 한 줄: `무대(Project.stage, 기본 10×6 m, 원점 중심, 객석 = +X): 3D 창마다 \`무대\` 버튼(기본 켜짐, 메인 = 스토어 stageShown), 크기는 인스펙터 \`무대\` 섹션(메인 무대가 켜졌을 때), 표시 전용. 스펙 docs/superpowers/specs/2026-10-19-stage-setup-design.md.`

- [ ] **Step 6: 커밋**

```bash
git add src/inspector/Inspector.tsx e2e/stage.spec.ts CLAUDE.md
git commit -m "feat(stage): 무대 size section in the inspector (shown while the main stage is on)"
```
