# 자세 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클립 보기 트랙을 로봇당 키 한 줄로 바꾸고, 오른쪽 관절 패널을 몸통(무대 위치·자세) + 모든 부위 목록(GO2 12개 모터 형태) + 기본 서기로·발 고정·바닥 밀착으로 개편하고, 메인 3D에서 로봇을 끌어 그 프레임의 무대 X·Y를 옮긴다.

**Architecture:** 순수 함수 `model/bodyPose.ts`(바닥 높이·발 고정 IK, 기존 `legIk` 위)를 스토어 액션 `editPose`(여러 채널을 한 제스처로 `setValue`, 발 고정·바닥 밀착 적용)가 쓰고, 패널과 3D 끌기가 모두 `editPose`를 부른다. 타임라인은 `buildRows`가 액터당 한 줄(전 채널)을 만들고 `TrackCanvas`에서 펼치기를 없앤다.

**Tech Stack:** React 19, TypeScript, three.js, zustand, vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-10-19-pose-panel-design.md`

## Global Constraints

- 범위: 클립 보기 `트랙` 탭(`TrackCanvas`)과 오른쪽 관절 패널, 메인 3D 끌기. 시퀀스 타임라인·그래프 구조·리드인·끝 기본자세·물리·CSV 코드는 건드리지 않음. `src/model/leadIn.sweep.test.ts`·`restTail.sweep.test.ts` 계속 통과.
- 모든 값 편집은 기존 `setValue`(수정 층 차이값 + `offsetPins` 앞뒤 15프레임 복귀)를 거친다. 여러 채널 편집은 한 제스처 = 실행취소 1회.
- `네 발 위치 고정`(G1 라벨 `두 발 위치 고정`)·`바닥 밀착 (높이 자동)`: 기본 꺼짐, 스토어 UI 필드(저장 안 함).
- 발 고정 실패 기준: 풀이 후 어느 발이든 위치 오차 > 0.01 m → 편집 적용 안 함, 안내 `네 발을 고정한 채 더 움직일 수 없습니다`(GO2) / `두 발을 고정한 채 더 움직일 수 없습니다`(G1), 3 s.
- 바닥 기준 = 기본자세(`rest.q`, root (0,0,`rest.z`), 기울기 0)에서 가장 낮은 발(`footMat` 원점 z).
- `기본 서기로`: 관절 = `rest.q`, `root.pitch`·`root.roll` = 0, `root.z` = `rest.z`(바닥 밀착이면 자동), `root.x/y/yaw` 유지. G1·GO2 공통.
- 몸통 라벨·채널·단위: `무대 X` root.x m step 0.01 · `무대 Y` root.y m 0.01 · `방향` root.yaw ° · `높이` root.z m 0.005 · `앞뒤 기울기` root.pitch ° · `좌우 기울기` root.roll °. 범위는 기존 `ROOT_RANGE`.
- GO2 부위 순서·라벨: `오른앞 (FR)`·`왼앞 (FL)`·`오른뒤 (RR)`·`왼뒤 (RL)`, 행 `고관절`(hip)·`허벅지`(thigh)·`무릎`(calf). G1: `RobotDef.groups` 이름, 행 = `_joint` 뗀 이름.
- 3D 끌기: 메인 3D만, 왼쪽 버튼, 4 px 넘으면 시작, X·Y만, 편집 불가 상태(잠금·크로스페이드·스티치·조각 밖·리드인 구간·클립 편집 모드·숨김)면 시작 안 함(카메라 동작). 커서 `grab`/`grabbing`.
- UI 문구 한국어, 대문자 라벨 금지, 색 토큰(CLAUDE.md). 작업 중엔 관련 테스트만, 전체 테스트는 푸시 직전(사용자 규칙).
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. 슬라이더를 끄는 중(이미 제스처 안)에 `editPose`가 불림 → 실행취소 1회로 남아야 함, 제스처가 열린 채 남지 않아야 함 (Task 2 테스트: `beginGesture` 안에서 `editPose` 두 번 → `undo` 한 번에 원래대로).
2. 발 고정 + 큰 이동(1 m) → 적용 안 되고 프로젝트 그대로 (Task 2 테스트 `toBe(before)`).
3. 수정 층이 이미 있는 조각에서 `기본 서기로`·`editPose` → 결과 자세가 목표값(원본 + 기존 수정 층 위에서) (Task 2 테스트: 먼저 setValue로 수정 넣고 standPose 후 evaluate 값 확인).
4. 3D에서 로봇을 클릭만(이동 < 4 px) → 지금처럼 관절 선택, 루트 값 안 바뀜 (Task 5 e2e).
5. 트랙 한 줄에서 ◆ 하나를 지움 → 그 프레임의 모든 채널 키가 지워지고 다른 프레임은 그대로 (Task 3 e2e/단위).

---

### Task 1: 몸통 계산 순수 함수 (`model/bodyPose.ts`)

**Files:**
- Create: `src/model/bodyPose.ts`
- Test: `src/model/bodyPose.test.ts` (로봇 정의는 `src/test/defs`의 `loadDef`, 모듈 최상단에서 한 번 — 기존 테스트 방식)

**Interfaces:**
- Produces:
  - `type Body = { x: number; y: number; z: number; roll: number; pitch: number; yaw: number }`
  - `bodyMat(b: Body): M` = `rootMat(b.x, b.y, b.z, b.roll, b.pitch, b.yaw)` (legIk)
  - `restFootZ(def: RobotDef): number` — 기본자세 가장 낮은 발 z (def별 캐시 가능)
  - `groundZ(def: RobotDef, q: ArrayLike<number>, b: Body): number` — 가장 낮은 발이 `restFootZ`가 되는 root z (x·y·yaw·roll·pitch는 b 그대로)
  - `lockFeet(def: RobotDef, q: number[], from: Body, to: Body): number[] | null` — `from`에서의 발 자세를 목표로 다리마다 `solveLeg`(root = `bodyMat(to)`), 새 q(복사본) 또는 발 위치 오차 > 0.01 m이면 `null`
  - `standQ(def: RobotDef): number[]` = `rest.q` 복사

- [ ] **Step 1: 실패하는 테스트**

```ts
test('groundZ: rest pose sits at rest.z; tilted pose keeps lowest foot on the floor', () => {
  for (const def of [g1, go2]) {
    const b = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 }
    expect(groundZ(def, def.rest.q, b)).toBeCloseTo(def.rest.z, 4)
    const tilt = { ...b, pitch: 0.2 }, z = groundZ(def, def.rest.q, tilt)
    const low = Math.min(...legsOf(def).map(l => footMat(l, bodyMat({ ...tilt, z }), def.rest.q)[11]))
    expect(low).toBeCloseTo(restFootZ(def), 3)
  }
})
test('lockFeet: small body move keeps feet within 1 cm; huge move fails', () => {
  for (const def of [g1, go2]) {
    const from = { x: 0, y: 0, z: def.rest.z, roll: 0, pitch: 0, yaw: 0 }
    const q = lockFeet(def, [...def.rest.q], from, { ...from, x: 0.05 })!
    expect(q).not.toBeNull()
    for (const l of legsOf(def)) {
      const a = footMat(l, bodyMat(from), def.rest.q), c = footMat(l, bodyMat({ ...from, x: 0.05 }), q)
      expect(Math.hypot(a[3] - c[3], a[7] - c[7], a[11] - c[11])).toBeLessThan(0.01)
    }
    expect(lockFeet(def, [...def.rest.q], from, { ...from, x: 1 })).toBeNull()
  }
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/model/bodyPose.test.ts` → FAIL (모듈 없음)
- [ ] **Step 3: 구현** — `groundZ`: z = 0으로 발 최저 z를 구해 `restFootZ − 최저`. `lockFeet`: 입력 q 복사 후 다리마다 `solveLeg(def, leg, bodyMat(to), footMat(leg, bodyMat(from), q원본), qCopy)`, 위치 오차 확인.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx tsc -b` 깨끗
- [ ] **Step 5: 커밋** `feat(pose): body helpers — floor height and foot-lock IK`

### Task 2: 스토어 자세 액션

**Files:**
- Modify: `src/store/store.ts`
- Test: `src/store/pose.test.ts` (새 파일, `store.test.ts`의 셋업 방식: `createEditorStore(defs)`, 첫 액터·클립)

**Interfaces:**
- Consumes: Task 1 전부
- Produces (EditorState):
  - `feetLock: boolean; setFeetLock(on: boolean): void` (기본 false)
  - `autoGround: boolean; setAutoGround(on: boolean): void` (기본 false)
  - `poseAt(actorId: string): { def: RobotDef; f: number; body: Body; q: number[] } | null` — `editView`가 보여 주는 값과 같은 자세(조각: `editedClip`, 클립 편집: `baseClip`, 편집 대상 프레임 `editTarget(...).f`)
  - `editPose(actorId: string, values: Record<string, number>): boolean` — 채널 이름 → 목표값(루트 `root.*`, 관절 이름). 순서: 목표 body·q 만들기 → 발 고정 켜짐 + 루트 값이 있으면 `lockFeet`(실패 → `false`, 아무것도 안 씀) → 바닥 밀착 켜짐 + `root.z`가 values에 없으면 `root.z = groundZ` → 현재와 1e-9 넘게 다른 채널마다 `setValue`, 전부 한 제스처(이미 열린 제스처 안이면 그 제스처에 합침). 성공 `true`.
  - `standPose(actorId: string): void` — `editPose`(관절 = `standQ`, pitch·roll = 0, z = `rest.z`(바닥 밀착이면 생략해 자동)) 단, 발 고정은 적용하지 않음.
  - `keyPose(actorId: string): void` — 기존 `keyGroup` 본문을 채널 목록 인자로 뽑아(`ROOT` + `def.joints` 이름 전부) 재사용. `keyGroup`은 남는 호출처가 없으면 지움.

- [ ] **Step 1: 실패하는 테스트** (`src/store/pose.test.ts`)

```ts
test('editPose writes several channels as one undo step, even inside an open gesture', () => {
  const before = s().project
  s().beginGesture()
  expect(s().editPose(actor, { 'root.x': 0.3, left_knee_joint: 0.5 })).toBe(true)
  expect(s().editPose(actor, { 'root.x': 0.4 })).toBe(true)
  s().endGesture()
  expect(s().poseAt(actor)!.body.x).toBeCloseTo(0.4)
  s().undo()
  expect(s().project).toBe(before)
})
test('feetLock: small move keeps feet, 1 m move is refused and changes nothing', () => {
  s().setFeetLock(true)
  expect(s().editPose(actor, { 'root.x': s().poseAt(actor)!.body.x + 0.03 })).toBe(true)
  const before = s().project
  expect(s().editPose(actor, { 'root.x': 5 })).toBe(false)
  expect(s().project).toBe(before)
})
test('autoGround: knee bend recomputes root.z so the lowest foot is on the floor', () => {
  s().setAutoGround(true)
  s().editPose(actor, { left_knee_joint: 1.2, right_knee_joint: 1.2 })
  const p = s().poseAt(actor)!
  expect(p.body.z).toBeCloseTo(groundZ(p.def, p.q, p.body), 3)
})
test('standPose: rest joints, zero tilt, rest height, x/y/yaw kept; works over an existing piece edit; one undo', () => {
  s().setValue(actor, 'left_knee_joint', 1)          // existing 수정 층
  s().editPose(actor, { 'root.x': 0.2, 'root.yaw': 0.5, 'root.pitch': 0.1 })
  const before = s().project
  s().standPose(actor)
  const p = s().poseAt(actor)!
  p.def.joints.forEach((j, i) => expect(p.q[i]).toBeCloseTo(p.def.rest.q[i], 4))
  expect(p.body).toMatchObject({ x: expect.closeTo(0.2), yaw: expect.closeTo(0.5), pitch: expect.closeTo(0), roll: expect.closeTo(0), z: expect.closeTo(p.def.rest.z) })
  s().undo(); expect(s().project).toBe(before)
})
test('keyPose keys every root and joint channel at the frame', () => { /* 조각 수정 층 소유자의 channels: ROOT + 모든 관절에 그 프레임 키 */ })
```
(`keyPose` 테스트는 같은 파일에서 소유자 `keyOwner`의 채널마다 `keys.some(k => k.f === f)`를 확인하도록 완성.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/store/pose.test.ts` → FAIL
- [ ] **Step 3: 구현** (위 Interfaces 그대로; 제스처 중첩 여부는 기존 `beginGesture`/`endGesture` 구현을 읽고 열린 제스처면 새로 열지 않음)
- [ ] **Step 4: 통과 확인** — `npx vitest run src/store/pose.test.ts src/store/store.test.ts src/store/pieceEdit.test.ts && npx tsc -b`
- [ ] **Step 5: 커밋** `feat(pose): editPose / standPose / keyPose with foot lock and auto ground`

### Task 3: 트랙 한 줄

**Files:**
- Modify: `src/timeline/timeScale.ts` (`buildRows`, `Row`), `src/timeline/TrackCanvas.tsx`
- Test: `src/timeline/timeScale.test.ts` (기존 `buildRows` 테스트 교체)
- Check: `src/timeline/GraphCanvas.tsx`(`group:` 해석은 그대로 둬도 동작해야 함)

**Interfaces:**
- Produces: `buildRows(p, defs, actors?) : Row[]` — 액터당 `{ kind: 'group', actorId, label: 이름, channels: [...ROOT_CHANNELS, ...def.joints 이름] }` 한 줄(`expanded` 인자·필드 없음). `rowKey`가 다른 곳에서 안 쓰이면 지움.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('buildRows: one row per actor holding root + every joint channel', () => {
  const p = g1Only(), rows = buildRows(p, defs)
  expect(rows).toHaveLength(1)
  expect(rows[0].channels).toEqual([...ROOT_CHANNELS, ...defs.g1.joints.map(j => j.name)])
})
test('hitKey on the one row returns every channel key at that frame', () => {
  // 두 채널(root.x, left_knee_joint)에 f=10 키, 한 채널에 f=20 키 → x(f=10) 히트 = 2개, 모두 f 10
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/timeline/timeScale.test.ts` → FAIL
- [ ] **Step 3: 구현** — `buildRows` 교체. `TrackCanvas`: `ui.expanded`·▸/▾·indent 분기 제거, 줄 그리기는 액터 색 라벨 한 줄, 라벨 열 클릭 = `select(actorId, null)`(채널 안 바꿈: 이미 그 액터면 `sel.channel` 유지), 키 클릭이 `select(k.actorId, k.channel)` 하던 곳은 액터만 맞추고 `sel.channel`은 유지(`select(actorId, s.sel.channel)` 또는 액터가 바뀔 때만 null). 키 집계·히트·박스·드래그·Delete·복사/붙여넣기·우클릭은 행의 `channels`를 그대로 쓰므로 자동으로 전 채널.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/timeline && npx tsc -b && npx playwright test e2e/pieceEdit.spec.ts e2e/clipEdit.spec.ts e2e/rangeEdit.spec.ts` (실패하는 기존 e2e가 그룹 줄 펼치기에 의존하면 한 줄 기준으로 고침)
- [ ] **Step 5: 커밋** `feat(track): one key row per robot in the clip view`

### Task 4: 관절 패널 개편

**Files:**
- Modify: `src/viewer/JointPanel.tsx`, `src/inspector/Inspector.tsx`, `src/styles.css`(`.jp-*`에 머리줄·몸통 섹션 최소 스타일)
- Test: `e2e/jointPanel.spec.ts`(갱신), `e2e/posePanel.spec.ts`(새)

**Interfaces:**
- Consumes: Task 2 `editPose`, `standPose`, `keyPose`, `feetLock`/`setFeetLock`, `autoGround`/`setAutoGround`, `poseAt`
- Produces: `editView(s)`는 액터가 선택돼 있으면(채널 없어도) 반환. 반환에서 `group`·`channels`(부위 한정) 대신 `sections: { title: string; rows: { ch: string; label: string }[] }[]`(몸통 제외 관절 부위) 제공.

- [ ] **Step 1: 실패하는 e2e** (`e2e/posePanel.spec.ts`, 부팅·GO2 액터 추가는 `go2blocks.spec.ts`/`follow.spec.ts` 방식, 액터 선택은 `__editor.getState().select(id, null)`)
  - GO2 선택 → `role=group name=관절 패널` 안에 머리줄 텍스트 순서 `오른앞 (FR)`, `왼앞 (FL)`, `오른뒤 (RR)`, `왼뒤 (RL)`, 슬라이더(`input[type=range]`) 6(몸통) + 12 = 18개.
  - `무대 X 숫자` 입력에 0.5 → `poseAt(id).body.x ≈ 0.5`, Ctrl+Z → 원래 값.
  - `기본 서기로` 클릭 → 관절 = `rest.q`(±1e-3).
  - `네 발 위치 고정` 토글 켬 → 관절 행 슬라이더·`기본 서기로` disabled.
  - G1 선택 → 머리줄 `왼다리`…`오른팔`, 발 고정 버튼 라벨 `두 발 위치 고정`.
- [ ] **Step 2: 실패 확인** — `npx playwright test e2e/posePanel.spec.ts` → FAIL
- [ ] **Step 3: 구현**
  - 패널 구조(위→아래): 머리(`값`, 프레임 표시) → 안내 줄(구간 밖·조각 밖·발 고정 실패 안내) → 도구 줄 2개 → `몸통 (무대 위치 · 자세)` 섹션(6행 + `네 발/두 발 위치 고정` `aria-pressed` 버튼 + `바닥 밀착 (높이 자동)` 체크박스 + `바닥에 맞추기` 버튼) → 부위 섹션들(머리줄 + 행) → `RangeRow`.
  - 행 모양·aria-label(`<ch> 슬라이더`, `<ch> 숫자`)은 기존 그대로 유지(기존 e2e 호환). 몸통 행의 이름 칸만 한국어 라벨, aria-label은 `무대 X 슬라이더`/`무대 X 숫자` 식 한국어.
  - 값 변경은 전부 `act.editPose(actorId, { [ch]: x })`; `false`면 발 고정 실패 안내(3 s).
  - 도구 줄: `◀ 키`/`키 ▶` = 소유자 모든 채널 키 프레임 기준, `키 추가` = `keyPose`, `키 삭제` = 그 프레임의 모든 채널 키 `deleteKeys`, `보간` = 그 프레임 모든 키 `setInterp`(표시값 = 선택 채널 키, 없으면 첫 키), `기본 서기로` = `standPose`.
  - ↑↓ = 전체 행 순서(몸통 6 → 부위 순)로 선택 이동.
  - 바닥 밀착 켜짐 → `높이` 행 disabled. 발 고정 켜짐 → 관절 행·`기본 서기로` disabled.
  - `Inspector.tsx`: `{group} 전체 키` 버튼과 그 계산(`group`, `groupNames`, `groupLocks`) 제거, 크로스페이드·스티치 안내는 선택 채널 기준 유지.
- [ ] **Step 4: 통과 확인** — `npx tsc -b && npx playwright test e2e/posePanel.spec.ts e2e/jointPanel.spec.ts e2e/editPane.spec.ts e2e/pieceOffset.spec.ts` (jointPanel.spec의 부위 한정 가정은 새 구조로 갱신)
- [ ] **Step 5: 커밋** `feat(pose): joint panel lists every part with a body section, stand, foot lock and auto ground`

### Task 5: 3D 끌기 (`Stage.tsx` 메인 창)

**Files:**
- Modify: `src/viewer/Stage.tsx`
- Test: `e2e/poseDrag.spec.ts`(새)

**Interfaces:**
- Consumes: Task 2 `editPose`

- [ ] **Step 1: 실패하는 e2e** — G1 액터 하나, 메인 3D 캔버스에서 로봇 골반의 화면 좌표(`__stage.camera`·`entries()`의 `rig.root` 월드 위치를 `project()`로)를 구해 `page.mouse` down → 60 px 오른쪽으로 move(steps 5) → up. 기대: `poseAt(id).body.x` 또는 `y`가 0.05 넘게 바뀜, 카메라 `camTarget()` 그대로. Ctrl+Z → 원래 값. 같은 지점 클릭만(이동 0) → `sel.channel`이 링크의 관절로, body 그대로.
- [ ] **Step 2: 실패 확인** — `npx playwright test e2e/poseDrag.spec.ts` → FAIL
- [ ] **Step 3: 구현**
  - `onDown`(mainView): 기즈모 위가 아니고, 레이캐스트가 보이는 비고스트 로봇에 맞으면 후보(actorId, 시작 포인터, 그 로봇 `rig.root` 월드 위치·회전, 바닥 평면 z = 0 위 잡은 점) 기록.
  - `pointermove`: 후보가 있고 4 px 넘으면 편집 가능 확인(`locked()`와 같은 조건을 채널 `root.x`로: `editLock`, `trackLocked`, `clipLocked`, `offStage`, 조각 밖, `s.clipEdit`) → 불가면 후보 버림(카메라가 계속). 가능하면 `orbit.enabled = false`, `beginGesture`, 커서 `grabbing`. 이후 매 move: 평면 교점 − 잡은 점 = (dx, dy) → 시작 월드 위치 + (dx, dy)를 `worldToClipRoot`(rootValues와 같은 placement·stitch 변환)로 클립 x·y → `editPose(actorId, { 'root.x', 'root.y' })`.
  - `pointerup`: 끄는 중이었으면 `endGesture`, `orbit.enabled = true`, 클릭 선택 생략. 아니면 기존 클릭 선택.
  - 호버 커서: 끌기 아닐 때 로봇 위 `grab`, 아니면 기본(포인터 이동마다 레이캐스트는 rAF당 한 번으로 제한).
  - 정리(cleanup)에서 새 리스너 제거.
- [ ] **Step 4: 통과 확인** — `npx tsc -b && npx playwright test e2e/poseDrag.spec.ts e2e/follow.spec.ts e2e/webgl.spec.ts e2e/originalGhost.spec.ts`
- [ ] **Step 5: 커밋** `feat(pose): drag a robot in the main 3D view to move its stage x/y at the frame`

### Task 6: 문서

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** 핵심 불변식에 한 줄 추가: `자세 패널(스펙 docs/superpowers/specs/2026-10-19-pose-panel-design.md): 클립 보기 트랙 = 로봇당 키 한 줄(◆ = 그 프레임 전 채널 키), 관절 편집은 오른쪽 관절 패널(몸통 무대 X·Y·방향·높이·기울기 + 부위 목록, GO2 FR·FL·RR·RL × 고관절·허벅지·무릎), 기본 서기로·발 위치 고정(legIk)·바닥 밀착(기본 꺼짐, 저장 안 함), 모든 편집 = editPose → setValue(수정 층). 메인 3D에서 로봇을 끌면 그 프레임 root.x·y(클릭만 = 관절 선택).` 그리고 기존 관절 패널 줄(`관절 패널(viewer/JointPanel.tsx) = … 고른 관절의 부위 전체 줄 …`)을 새 구조에 맞게 고침.
- [ ] **Step 2:** `npx vitest run src/model/leadIn.sweep.test.ts src/model/restTail.sweep.test.ts` PASS 확인
- [ ] **Step 3: 커밋** `docs: pose panel invariants`
