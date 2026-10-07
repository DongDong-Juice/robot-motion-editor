# 모션 편집기 M2(시퀀스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 액터 트랙에 여러 클립을 배치·트림·자르기·크로스페이드하고, 클립을 더블클릭해 중첩 클립 보기에서 키를 편집하며, 마커·In/Out, Unitree CSV 가져오기, 프로젝트 저장/열기를 지원한다.

**Architecture:** `evaluate`가 트랙의 여러 Item을 해석(겹침 = 선형 블렌드, 루트 이어붙이기)하는 유일한 포즈 경로로 남는다. 스토어는 클립 단위 구조 공유로 큰 클립에서도 실행취소 메모리를 억제하고, `editing`(중첩 클립 보기) 상태와 `editTarget`으로 "지금 편집 중인 클립·프레임"을 한 곳에서 결정한다. 타임라인은 시퀀스 보기(Item 막대)와 클립 보기(기존 키 트랙/그래프)로 나뉜다.

**Tech Stack:** 기존과 동일 (Vite, React, TS, three, zustand, vitest, @playwright/test). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-07-robot-motion-editor-design.md` (M2 = 10절 2번; 규칙은 4·5·6절)

## Global Constraints

- M1 Global Constraints 전부 유지 (60fps, CSV 형식·열 순서, 런타임 의존성 4개, 파일 API는 `src/fileio.ts`만, 색 토큰·서체·금지 스타일).
- GO2 CSV 관절 순서 = URDF 순서 (FL, FR, RL, RR) — 사용자 확정.
- 크로스페이드: 같은 트랙에서 겹친 구간 = 블렌드 구간, 가중치 선형. 관절·위치 lerp, 루트 회전 slerp.
- 루트 이어붙이기: 뒤 Item의 루트 x, y, yaw를 앞 Item의 (뒤 Item 시작 프레임) 루트 포즈 기준으로 변환. z·roll·pitch 그대로. 첫 Item은 액터 배치만.
- 빈 구간: 직전 포즈 유지, 맨 앞이면 첫 Item 첫 포즈 (M1과 동일).
- 클립 재사용 = 공유: 여러 Item이 같은 클립을 참조하면 내부 편집이 모두에 반영.
- 한 트랙에서 Item은 인접한 둘끼리만 겹칠 수 있고(3중 겹침 금지), 겹침 길이 ≤ 두 Item 길이 중 작은 값 − 1.
- 프로젝트 파일: JSON 1개 `*.motion.json`, `version: 1`, 미디어 경로 미저장.
- 문구는 한국어, 버튼은 동작 이름("저장", "열기", "CSV 가져오기"), 결과 메시지는 같은 동사("저장했습니다").

## Review Focus

1. 크로스페이드 이음새에서 루트 위치가 튀는 경우 → 이음새 첫 프레임 블렌드 결과가 앞 Item 포즈와 같아야 함 (Task 2 테스트).
2. 클립 보기에서 트림 밖 프레임을 편집 → 키는 클립 프레임에 생기고, 시퀀스의 다른 Item에 쓰이지 않음 (Task 4 테스트).
3. 수천 프레임 CSV 가져오기 후 편집 1회 → 건드리지 않은 클립은 참조 동일(복사 없음), 커브 평가는 이진 탐색 (Task 1 테스트).
4. 잘못된 프로젝트 파일(버전 다름, 필드 누락, 깨진 JSON) 열기 → 현재 프로젝트 유지 + 이유 표시 (Task 8 테스트).
5. 이미 쓰이는 클립 삭제, 다른 로봇 트랙에 클립 놓기, 3중 겹침 → 거부되고 프로젝트 불변 (Task 3 테스트).

---

## 파일 구조

```
src/model/curve.ts            (수정) 이진 탐색
src/model/sequence.ts         (신규) resolveAt, stitchTransforms, blendPose — 순수
src/model/evaluate.ts         (수정) evaluate가 sequence.ts 사용, evaluateItem 추가
src/model/projectFile.ts      (신규) serializeProject / parseProject — 순수
src/export/importCsv.ts       (신규) csvToClip — 순수
src/store/store.ts            (수정) 구조 공유 edit, Item·클립·마커·editing 액션, editTarget
src/timeline/SequenceCanvas.tsx (신규) 시퀀스 보기
src/timeline/ruler.ts         (신규) 눈금자·마커·In/Out 그리기 (Sequence/Track/Graph 공용)
src/timeline/Timeline.tsx     (수정) 시퀀스 ⇄ 클립 보기, 브레드크럼
src/timeline/TrackCanvas.tsx, GraphCanvas.tsx (수정) editTarget 사용, 클립 프레임 축
src/project/ProjectPanel.tsx  (신규) 액터·클립 목록, 새 클립, 이름 변경, 삭제, 드래그, CSV 가져오기
src/viewer/Stage.tsx          (수정) 궤적 = 시퀀스 전체, 클립 보기 고스트
src/inspector/Inspector.tsx   (수정) editTarget 사용
src/transport.ts              (수정) In/Out 루프, I/O/M/C/Delete/Esc, Ctrl+S/O
src/fileio.ts                 (수정) openTextFile, saveTextFile
src/App.tsx                   (수정) 파일 메뉴, 더티 표시, beforeunload
e2e/sequence.spec.ts          (신규)
```

---

### Task 1: 구조 공유 실행취소 + 커브 이진 탐색

**Files:**
- Modify: `src/store/store.ts`, `src/model/curve.ts`
- Test: `src/store/store.test.ts`, `src/model/curve.test.ts`

**Interfaces:**
- Produces: 내부 `edit(fn: (p: Project) => void, touched: string[])` — 새 프로젝트 = `{ ...p, actors: structuredClone(p.actors), sequence: structuredClone(p.sequence), clips: { ...p.clips } }` 후 `touched`의 클립만 `structuredClone`. 기존 모든 액션은 자기가 수정하는 clipId만 넘긴다(배치·색·액터 추가는 `[]`). 공개 API 변화 없음.
- `evalCurve` 동작 동일, 구간 탐색만 이진 탐색(`f` 이하 마지막 키).

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('edit shares untouched clips by reference', () => {
    const before = s().project
    const [g1Clip, go2Clip] = clipIdsOf(before)
    s().setKey(g1Clip, 'left_knee_joint', 0, 0.5)
    expect(s().project.clips[go2Clip]).toBe(before.clips[go2Clip])
    expect(s().project.clips[g1Clip]).not.toBe(before.clips[g1Clip])
    expect(before.clips[g1Clip].channels['left_knee_joint']).toBeUndefined()   // 이전 스냅샷 불변
  });
  test('evalCurve on 5000 linear keys matches direct interpolation', () => {
    const c = { keys: Array.from({ length: 5000 }, (_, i) => makeKey(i, Math.sin(i / 50), 'linear')) }
    expect(evalCurve(c, 2500.5, 0)).toBeCloseTo((Math.sin(2500/50) + Math.sin(2501/50)) / 2, 9)
    expect(evalCurve(c, 4999, 0)).toBeCloseTo(Math.sin(4999/50), 9)
  });
  ```
- [ ] **Step 2:** `npx vitest run src/store src/model/curve` → 첫 테스트 FAIL.
- [ ] **Step 3:** 구현. 기존 테스트 전부 유지.
- [ ] **Step 4:** `npx vitest run` 전체 PASS, `npx tsc -b`.
- [ ] **Step 5:** Commit `perf(store): share untouched clips across undo; binary-search curve segments`.

---

### Task 2: 시퀀스 평가 (여러 Item, 크로스페이드, 루트 이어붙이기)

**Files:**
- Create: `src/model/sequence.ts`, `src/model/sequence.test.ts`
- Modify: `src/model/evaluate.ts`

**Interfaces:**
- Consumes: `evaluateClip`, `eulerToQuat`, `quatMul`, `quatYaw`, `yawQuat` (`rootMath.ts`).
- Produces:
  ```ts
  interface Xf { x: number; y: number; yaw: number }                      // 클립 루트 → 트랙 좌표
  function itemLen(it: Item): number                                       // trimOut − trimIn
  function sortedItems(track: Track): Item[]                               // start 오름차순
  function stitchTransforms(p: Project, defs: RobotDefs, track: Track): Map<string, Xf>  // itemId → Xf, WeakMap(Project) 캐시
  function applyXf(pose: Pose, xf: Xf): Pose
  function slerp(a: Quat, b: Quat, t: number): Quat
  function blendPose(a: Pose, b: Pose, w: number): Pose                    // w=0 → a, w=1 → b
  // evaluate.ts
  function evaluateItem(p: Project, defs: RobotDefs, itemId: string, clipFrame: number): Pose   // Xf + 배치 적용(월드), 트림 무시
  function evaluate(p, defs, actorId, frame): Pose                        // 시그니처 동일
  ```
- 규칙:
  - 첫 Item `Xf = {0,0,0}`. Item i(>0): `P` = 앞 Item까지 이어붙인 트랙 좌표 포즈를 프레임 `item_i.start`에서 평가(앞 Item 범위 밖이면 앞 Item 마지막 프레임), `C` = Item i 클립의 `trimIn` 루트 포즈. `yaw = quatYaw(P.rootQuat) − quatYaw(C.rootQuat)`, `(x,y) = P.xy − Rz(yaw)·C.xy`.
  - `applyXf`: `pos = Rz(yaw)·pos.xy + (x,y)`, z 유지, `quat = yawQuat(yaw) ⊗ quat`.
  - 겹침: 정렬된 인접 Item A, B에서 `s = B.start`, `e = A.start + itemLen(A)`, `s < e`이면 `f ∈ [s, e)`에서 `w = (f − s + 1)/(e − s + 1)`로 `blendPose(A(f), B(f), w)`.
  - 겹침 없으면 M1 `resolve` 규칙(앞 = 첫 Item trimIn, 빈 구간·뒤 = 직전 Item 마지막 프레임).
  - 배치(placement)는 마지막에 한 번 적용(M1과 동일).

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('single item identical to M1 evaluate', () => { /* 기존 evaluate.test 케이스를 그대로 통과 */ })
  test('stitch: B starts where A ended (x, y, yaw)', () => {
    // A: root.x 0→1 over 60f, root.yaw 0→π/2 ; B: root.x 0→1 over 60f, yaw 0. B.start = 60 (겹침 없음)
    const a59 = evaluate(p, defs, actor, 59), b60 = evaluate(p, defs, actor, 60)
    expect(dist2d(a59, b60)).toBeLessThan(0.02)                // 한 프레임 이동량 이내
    expect(quatYaw(b60.rootQuat)).toBeCloseTo(Math.PI / 2, 2)
    const b119 = evaluate(p, defs, actor, 119)                  // B 이동은 A 끝 yaw(+y 방향)로
    expect(b119.rootPos[1] - b60.rootPos[1]).toBeCloseTo(1 * 59/59, 1)
  });
  test('crossfade: weights and continuity', () => {
    // A: knee 0 constant, len 60 ; B: knee 1 constant, start 40 → 겹침 [40,60), 21칸
    expect(knee(evaluate(p, defs, actor, 39))).toBe(0)
    expect(knee(evaluate(p, defs, actor, 40))).toBeCloseTo(1/21)
    expect(knee(evaluate(p, defs, actor, 59))).toBeCloseTo(20/21)
    expect(knee(evaluate(p, defs, actor, 60))).toBe(1)
  });
  test('crossfade seam has no root jump', () => {
    const w = validatePoses(range(p, actor, 0, 120), g1, 0).filter(x => x.kind === 'rootJump')
    expect(w).toEqual([])
  });
  test('slerp endpoints and midpoint', () => { /* yaw 0, yaw π/2 → t=.5 yaw π/4 */ })
  test('evaluateItem ignores trims (clip frame outside trim)', () => { /* trimIn 30 Item, clipFrame 0 = 클립 프레임 0 값 */ })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현 (`resolve`는 sequence.ts로 이동). **Step 4:** 전체 PASS.
- [ ] **Step 5:** Commit `feat(model): multi-item sequence evaluation with crossfade and root stitching`.

---

### Task 3: 스토어 — Item·클립 편집

**Files:**
- Modify: `src/store/store.ts`, `src/model/defaults.ts`
- Test: `src/store/store.test.ts`

**Interfaces:**
- Consumes: `sortedItems`, `itemLen` (Task 2).
- Produces (EditorState에 추가; 반환 `boolean` = 적용 여부, 거부 시 프로젝트·undo 불변):
  ```ts
  selItem: string | null; selectItem(itemId: string | null): void
  newClip(robot: RobotKind): string                         // 길이 120, 이름 "clip_NN"(같은 로봇 클립 수+1, 2자리), 트랙에 배치 안 함
  deleteClip(clipId: string): boolean                       // 어떤 Item도 참조하지 않을 때만
  addItem(actorId: string, clipId: string, start: number): boolean   // 로봇 불일치·규칙 위반 시 false; trimIn 0, trimOut = clip.length
  moveItem(itemId: string, start: number): boolean
  trimItem(itemId: string, side: 'in' | 'out', df: number): boolean  // in: start+=df, trimIn+=df / out: trimOut+=df; 0 ≤ trimIn < trimOut ≤ length
  splitItem(itemId: string, frame: number): boolean         // frame은 시퀀스 프레임, Item 내부(양쪽 길이 ≥1)만. 같은 clip 참조 두 Item
  deleteItem(itemId: string): boolean                       // 트랙의 마지막 Item도 삭제 가능
  ```
- 트랙 규칙 검사 `validTrack(items: Item[]): boolean` (export): `start ≥ 0`, 정렬 후 i+2는 i와 겹치지 않음, 인접 겹침 ≤ `min(len_i, len_{i+1}) − 1`, 같은 start 금지.
- `defaults.ts`: `nextClipName(p, robot)` 공유(`makeActor`도 사용) → 첫 클립 `clip_01`.
- 액터의 Item이 0개일 때 `clipFrameAt`은 throw → Task 4가 대체하므로 여기서는 그대로.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('addItem rejects robot mismatch', () => { expect(s().addItem(g1Actor, newGo2Clip, 200)).toBe(false); expect(s().project).toBe(before) })
  test('addItem + overlap rules', () => {
    const c = s().newClip('g1')
    expect(s().addItem(g1Actor, c, 100)).toBe(true)          // [0,120) & [100,220) 겹침 20
    expect(s().addItem(g1Actor, c, 110)).toBe(false)         // 3중 겹침
    expect(s().addItem(g1Actor, c, 0)).toBe(false)           // 같은 start
  })
  test('trimItem in/out bounds', () => { /* trimIn<0 거부, trimOut>length 거부, in 트림이 start도 이동 */ })
  test('splitItem makes two items sharing the clip', () => {
    expect(s().splitItem(item0, 50)).toBe(true)
    const its = trackItems(g1Actor)
    expect(its.map(i => [i.start, i.trimIn, i.trimOut])).toEqual([[0, 0, 50], [50, 50, 120]])
    expect(its[0].refId).toBe(its[1].refId)
  })
  test('deleteClip refuses clip in use', () => { expect(s().deleteClip(usedClip)).toBe(false) })
  test('each sequence edit is one undo entry', () => { s().moveItem(item0, 30); s().undo(); expect(start(item0)).toBe(0) })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(store): sequence item editing (add/move/trim/split/delete) and clip bin`.

---

### Task 4: 스토어 — 중첩 클립 보기, editTarget, 마커·In/Out

**Files:**
- Modify: `src/store/store.ts`, `src/inspector/Inspector.tsx`, `src/viewer/Stage.tsx`, `src/timeline/TrackCanvas.tsx`, `src/timeline/GraphCanvas.tsx`
- Test: `src/store/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  editing: string | null                                  // 열린 Item id (클립 보기)
  openItem(itemId: string): void                          // selItem·sel.actorId도 그 Item 액터로
  closeItem(): void
  // 순수, export
  function editTarget(s: Pick<EditorState,'project'|'frame'|'editing'>, actorId: string):
    { clipId: string; f: number; itemId: string } | null
  // 클립 보기 & 그 액터: Item = editing, f = clamp(frame − item.start + item.trimIn, 0, clip.length − 1)  ← 트림 무시
  // 그 외: 그 프레임을 덮는 Item(겹침이면 뒤 Item) → f = frame − start + trimIn; 덮는 Item 없으면 resolve 규칙의 Item·프레임; Item 0개면 null
  setIn(f: number | null): void; setOut(f: number | null): void   // inF < outF 아니면 반대쪽을 null로
  addMarker(f: number): void                              // 이름 "마커 N"
  renameMarker(index: number, name: string): void; deleteMarker(index: number): void
  ```
- `clipFrameAt` 삭제 → 모든 호출부(`setValue`, `keyGroup`, Inspector, Stage 루트 기즈모, TrackCanvas 붙여넣기·보간, GraphCanvas)를 `editTarget(getState(), actorId)`로 교체. null이면 편집 동작 무시.
- `deleteItem`/`undo`/`redo`로 `editing` Item이 사라지면 `editing = null`.
- 마커·In/Out은 실행취소 대상(프로젝트 변경).

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('editTarget in clip view ignores trims and other items', () => {
    s().trimItem(item0, 'in', 30)                           // start 30, trimIn 30
    s().openItem(item0); s().setFrame(0)                    // 시퀀스 0 → 클립 프레임 0 (트림 밖)
    expect(editTarget(s(), g1Actor)).toEqual({ clipId, f: 0, itemId: item0 })
    s().toggleAutoKey(); s().setValue(g1Actor, 'left_knee_joint', 0.4)
    expect(keyAt(clipId, 'left_knee_joint', 0).v).toBeCloseTo(0.4)
  })
  test('editTarget in sequence view picks item covering frame (later on overlap)', () => { /* 겹침 구간에서 B */ })
  test('editTarget null for actor without items', () => { /* deleteItem 후 null, setValue는 무시 */ })
  test('closeItem when edited item deleted / undone', () => { /* editing → null */ })
  test('in/out ordering', () => { s().setIn(100); s().setOut(50); expect([inF, outF]).toEqual([100, null]) })
  test('markers add/rename/delete undoable', () => { /* … */ })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 스토어 구현 후 호출부 교체(동작 변화 없음 확인: 기존 테스트 전부 PASS).
- [ ] **Step 4:** `npx vitest run`, `npx tsc -b`, `npm run e2e`(M1 스모크) PASS.
- [ ] **Step 5:** Commit `feat(store): nested clip view target, markers and in/out`.

---

### Task 5: 시퀀스 보기 UI + 공용 눈금자

**Files:**
- Create: `src/timeline/SequenceCanvas.tsx`, `src/timeline/ruler.ts`, `src/timeline/ruler.test.ts`
- Modify: `src/timeline/Timeline.tsx`, `src/timeline/TrackCanvas.tsx`, `src/timeline/GraphCanvas.tsx`, `src/transport.ts`

**Interfaces:**
- Consumes: Task 3·4 액션, `tv`(공유 시간 창), `sortedItems`, `itemLen`.
- Produces:
  ```ts
  // ruler.ts — 순수 계산 + 그리기
  function tickStep(ppf: number): { minor: number; major: number }        // 라벨 간격 ≥ 60px
  function drawRuler(ctx, sc: TimeScale, w: number, h: number, seq: Sequence, frame: number, C: Colors): void  // 눈금·타임코드·마커(▼)·In/Out 음영
  function hitMarker(seq: Sequence, sc: TimeScale, x: number): number | null   // ±4px
  ```
- Timeline: `editing == null` → 시퀀스 보기(`SequenceCanvas`), 아니면 클립 보기(기존 트랙/그래프). 상단 브레드크럼 "시퀀스 ▸ <액터> / <클립>" (시퀀스 클릭 = `closeItem`). 그래프 토글은 클립 보기에서만 활성.
- SequenceCanvas (행 높이 28px, 라벨 160px, 행 = 모션 트랙):
  - Item 막대: 액터 색 18% 바탕 + 1px 액터 색 테두리, 클립 이름. 겹침 구간은 대각선 해칭(╳). 선택 Item 테두리 `--accent`.
  - 클릭 = `selectItem`, 막대 가운데 드래그 = 이동(미리보기 후 놓을 때 `moveItem`, 실패 시 원위치), 양 끝 6px 드래그 = 트림, 더블클릭 = `openItem`.
  - 빈 곳/눈금자 클릭·드래그 = `setFrame`. 마커 클릭 = 그 프레임으로 이동, 더블클릭 = 이름 변경(인라인 `<input>`), 우클릭 = 삭제.
  - 드롭 대상: `dataTransfer` 타입 `application/x-motion-clip`(값 clipId) → 행의 액터에 `addItem(actor, clip, xToFrame)`; 실패 시 행 아래 한 줄 메시지 "이 트랙에는 <로봇> 클립만 놓을 수 있습니다" 또는 "겹치는 클립이 너무 많습니다" 2초.
- TrackCanvas/GraphCanvas(클립 보기): 시간축 = 클립 프레임 0..length−1 (`x0 = LABEL_W − tv.scrollF·ppf`, 시퀀스 프레임 변환 없음). 트림 밖은 어둡게. 재생헤드 = `editTarget(...).f`. 행 = 편집 중 액터만. 눈금자는 `drawRuler`(클립 보기에서는 마커 없음).
- 단축키(transport.ts, 입력 중 무시): `I`/`O` = setIn/setOut(현재 프레임), `M` = addMarker, `C` = selItem을 재생헤드에서 `splitItem`, `Delete` = 시퀀스 보기에서 selItem 삭제(클립 보기는 기존 키 삭제), `Esc` = `closeItem`.
- 재생: In/Out 둘 다 있으면 그 구간 반복, 아니면 기존. 클립 보기에서는 편집 Item의 클립 전체 길이 반복 (재생헤드 시퀀스 프레임 = `item.start − trimIn + f`).

- [ ] **Step 1: 실패 테스트** (`ruler.test.ts`)
  ```ts
  test('tickStep keeps labels ≥60px', () => { for (const ppf of [0.5, 1, 4, 16]) expect(tickStep(ppf).major * ppf).toBeGreaterThanOrEqual(60) })
  test('hitMarker within 4px', () => { /* 마커 f=30, ppf 4 → x=x0+120±3 히트, +6 미스 */ })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현 → PASS.
- [ ] **Step 4:** 브라우저(Playwright 스크립트, scratchpad): Item 이동·트림·C 자르기·겹치기(해칭 표시)·더블클릭 진입·Esc 복귀·I/O 구간 반복 재생 확인.
- [ ] **Step 5:** Commit `feat(timeline): sequence view with items, crossfades, markers, in/out`.

---

### Task 6: 프로젝트 패널 + 무대 갱신

**Files:**
- Create: `src/project/ProjectPanel.tsx`
- Modify: `src/App.tsx` (`#project`), `src/viewer/Stage.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `newClip`, `deleteClip`, `setClip`, `select`, `addItem`, `editing`, `evaluate`, `evaluateItem`, `sequenceEnd`.
- ProjectPanel:
  - "액터" 목록: 색 점 + 이름, 클릭 = `select(actorId)`.
  - "클립" 목록: 로봇별 묶음, 행 = 이름 · 길이(초, 소수 2자리) · 사용 수(Item 수). 더블클릭 = 이름 변경(인라인), 행 `draggable` (`application/x-motion-clip`), Delete 키/휴지통 버튼 = `deleteClip`(거부 시 "시퀀스에서 쓰는 클립은 삭제할 수 없습니다").
  - 버튼: "새 G1 클립", "새 GO2 클립", "CSV 가져오기"(Task 7이 연결; 이 Task에서는 비활성으로 둠).
- Stage:
  - 궤적 = 각 액터 `evaluate` 프레임 0..`sequenceEnd` (액터별 캐시, 그 액터 트랙 Item·참조 클립·배치가 바뀔 때만 재계산 — 비교는 참조 동일성).
  - 클립 보기(`editing`): 편집 액터 = `evaluateItem(editing, f)`(f = editTarget.f), 다른 액터 = `evaluate(시퀀스 프레임)` + `setGhost(true)`(선택 불가). 시퀀스 보기로 돌아오면 고스트 해제.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** 브라우저 확인: 새 클립 → 트랙에 드래그 → 시퀀스에 막대, GO2 클립을 G1 트랙에 드롭 → 거부 문구, 사용 중 클립 삭제 거부, 클립 보기에서 다른 로봇 반투명, 궤적이 두 Item 전체를 이어 그림.
- [ ] **Step 3:** `npx vitest run`, `npx tsc -b`, `npm run build`.
- [ ] **Step 4:** Commit `feat(project): clip bin panel; stage trails over full sequence, ghosts in clip view`.

---

### Task 7: Unitree CSV 가져오기

**Files:**
- Create: `src/export/importCsv.ts`, `src/export/importCsv.test.ts`
- Modify: `src/fileio.ts`, `src/project/ProjectPanel.tsx`, `src/store/store.ts`

**Interfaces:**
- Consumes: `RobotDefs`, `nearestAngle` (rootMath), `quatYaw`, `makeKey`, `slerp` (Task 2).
- Produces:
  ```ts
  function csvToClip(text: string, defs: RobotDefs, srcFps: 30 | 60, name: string): Clip   // 오류 시 throw Error(한국어 메시지)
  // fileio.ts
  async function openTextFiles(accept: string, multiple: boolean): Promise<{ name: string; text: string }[]>  // 취소 → []
  // store
  importClip(clip: Clip): void                                // 클립 목록에 추가 (undo 1개)
  ```
- 규칙: 빈 줄 무시. 열 수 36 → g1, 19 → go2, 그 외 `"열 수가 36(G1) 또는 19(GO2)가 아닙니다: N"`. 숫자 아닌 값 → `"N행에 숫자가 아닌 값이 있습니다"`. 30fps는 60fps로 리샘플(위치·관절 선형, 쿼터니언 slerp; 길이 = 2N−1). 쿼터니언 → ZYX 오일러, roll·pitch·yaw 각각 직전 프레임 기준 `nearestAngle`로 풀기. 모든 채널 매 프레임 `linear` 키. 이름 = 파일 이름에서 `.csv` 제거, `length` = 프레임 수.
- ProjectPanel "CSV 가져오기": `openTextFiles('.csv', true)` → fps 선택(작은 `<dialog>`: 30/60 라디오, 기본 30) → 파일마다 `csvToClip` → `importClip`. 실패한 파일은 이름과 이유를 목록으로 표시, 성공한 것은 추가. 완료 문구 "클립 N개를 가져왔습니다".

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('roundtrip: export → import → export at 60fps equals', () => {
    const csv1 = posesToCsv(samplePoses(proj, defs, g1Actor, g1Item, 'world'))   // 루트·관절 키 있는 클립
    const clip = csvToClip(csv1, defs, 60, 'rt')
    expect(clip.robot).toBe('g1'); expect(clip.length).toBe(120)
    const csv2 = posesToCsv(poseRows(clip))                                       // evaluateClip 0..length-1, 부호 연속 처리 동일
    expectCsvClose(csv1, csv2, 1e-5)
  })
  test('30fps resampled to 60fps (2N-1 frames, midpoints interpolated)', () => { /* 3행 → 5프레임, 관절 중간값 평균 */ })
  test('yaw beyond π stays continuous after import', () => { /* yaw 3.0→3.3 CSV → root.yaw 키 단조 증가 */ })
  test('bad column count and non-numeric rejected', () => {
    expect(() => csvToClip('1,2,3\n', defs, 60, 'x')).toThrow('열 수가')
    expect(() => csvToClip(row36.replace('0.0', 'abc'), defs, 60, 'x')).toThrow('숫자가 아닌')
  })
  test('GO2 detected by 19 columns', () => { /* … */ })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현 → PASS. **Step 4:** UI 연결 후 브라우저: Unitree 형식 CSV 2개(하나는 깨진 파일) 가져오기 → 하나 추가 + 실패 사유 표시.
- [ ] **Step 5:** Commit `feat(import): Unitree CSV to clip with 30→60fps resample`.

---

### Task 8: 프로젝트 저장 / 열기

**Files:**
- Create: `src/model/projectFile.ts`, `src/model/projectFile.test.ts`
- Modify: `src/fileio.ts`, `src/store/store.ts`, `src/App.tsx`, `src/transport.ts`

**Interfaces:**
- Produces:
  ```ts
  function serializeProject(p: Project): string                 // JSON.stringify(p, null, 1)
  function parseProject(text: string, defs: RobotDefs): Project // 오류 시 throw Error(한국어)
  // fileio.ts
  type SaveHandle = unknown
  async function saveTextFile(text: string, suggested: string, handle: SaveHandle | null): Promise<{ handle: SaveHandle | null; name: string } | null>
     // handle 있으면 덮어쓰기, 없으면 showSaveFilePicker(.motion.json) → 미지원이면 <a download>; 취소 → null
  async function openTextFiles(...)                             // Task 7 것 재사용
  // store
  fileName: string | null; dirty: boolean
  loadProject(p: Project, fileName: string | null): void        // undo/redo 비움, editing/sel/selItem 초기화, frame 0, dirty false
  markSaved(fileName: string): void
  newProjectFile(): void                                        // newProject()로 loadProject
  ```
- `dirty`: 프로젝트를 바꾸는 모든 commit에서 true (undo/redo 포함), `loadProject`/`markSaved`에서 false.
- `parseProject` 검사: JSON 파싱 실패 → "프로젝트 파일을 읽을 수 없습니다"; `version !== 1` → "지원하지 않는 버전입니다: V"; `fps !== 60`; actors/clips/sequence 구조·필수 필드 타입; Item.refId가 clips에 있음; 액터 robot이 defs에 있음; 실패 시 첫 번째 문제를 메시지로.
- App 메뉴바 앞에 "파일" 묶음: "새 프로젝트", "열기", "저장", "다른 이름으로 저장". 제목 영역 = `<파일이름 또는 "새 프로젝트">` + 더티면 " •". 새 프로젝트·열기 전 dirty면 `confirm("저장하지 않은 변경 사항이 있습니다. 계속할까요?")`. `beforeunload`는 dirty일 때만 경고. 단축키 Ctrl+S(저장), Ctrl+Shift+S(다른 이름), Ctrl+O(열기). 결과 문구 "저장했습니다" / 열기 실패 시 "열기 실패: <이유>" (메뉴바 한 줄, 3초).

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('roundtrip preserves project', () => { expect(parseProject(serializeProject(p), defs)).toEqual(p) })
  test('rejects bad json / version / missing refs', () => {
    expect(() => parseProject('{', defs)).toThrow('읽을 수 없습니다')
    expect(() => parseProject(JSON.stringify({ ...p, version: 2 }), defs)).toThrow('버전')
    expect(() => parseProject(JSON.stringify(withDanglingRef(p)), defs)).toThrow()
  })
  test('loadProject resets history and dirty', () => {
    s().setKey(c, ch, 0, 1); expect(s().dirty).toBe(true)
    s().loadProject(p2, 'a.motion.json'); s().undo()
    expect(s().project).toBe(p2); expect(s().dirty).toBe(false)
  })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현 → PASS. **Step 4:** 브라우저: 편집 → 저장(다운로드 폴백) → 새 프로젝트 → 열기(파일 입력) → 같은 시퀀스·키 복원, 깨진 파일 열기 → 현재 프로젝트 유지 + 이유 표시.
- [ ] **Step 5:** Commit `feat(file): project save/open with validation and dirty tracking`.

---

### Task 9: E2E — 시퀀스·가져오기·저장

**Files:**
- Create: `e2e/sequence.spec.ts`, `e2e/fixtures/walk_g1.csv` (테스트 안에서 생성해도 됨)

**Interfaces:**
- Consumes: `window.__editor`, 프로젝트 패널 버튼 이름, 내보내기 대화상자.

- [ ] **Step 1: 테스트**
  ```ts
  test('import CSV, place two items with crossfade, export both', async ({ page }) => {
    // showDirectoryPicker/showOpenFilePicker/showSaveFilePicker 삭제 → 폴백 경로
    // 1) setInputFiles로 36열 CSV(60행, 60fps) 가져오기 → 클립 목록에 이름 표시
    // 2) __editor로 addItem(G1, 가져온 클립, 100) → 기존 Item [0,120)과 겹침 20
    // 3) 내보내기 → G1 파일 2개 + GO2 1개 다운로드; G1 두 번째 파일 행 수 60, 36열
    // 4) 두 번째 파일 첫 행 루트 x,y는 로컬 모드라 0
  })
  test('save and reopen restores sequence', async ({ page }) => {
    // 키 1개 + Item 이동 → 저장(다운로드) → 새 프로젝트 → 열기(setInputFiles로 저장본) → Item start·키 값 동일
  })
  ```
- [ ] **Step 2:** `npm run e2e` → 기존 스모크 포함 전부 PASS.
- [ ] **Step 3:** `npx vitest run`, `npx tsc -b`, `npm run build` PASS.
- [ ] **Step 4:** Commit `test(e2e): sequence, import and save/open`.
