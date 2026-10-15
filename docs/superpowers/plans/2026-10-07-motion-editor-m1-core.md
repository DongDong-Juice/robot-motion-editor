# 모션 편집기 M1(코어) Implementation Plan

> **상태 (2026-10-12):** 완료 · `master` 머지됨. 아래 체크박스는 작업 중 갱신하지 않았음 — 진행 기록은 git 이력을 볼 것.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** G1·GO2를 한 무대에 올려 액터당 클립 1개를 키프레임·그래프로 편집하고, 클립 단위 Unitree 형식 CSV(60fps)로 내보내는 웹 편집기.

**Architecture:** 순수 함수 코어(`robot/`, `model/`, `export/`)가 포즈 평가·CSV 생성을 담당하고, zustand 스토어가 프로젝트 상태·실행취소를 들고, React 패널 + three.js 무대 + Canvas 2D 타임라인이 그 위에 얹힌다. 뷰어와 CSV는 같은 `evaluate`를 쓴다.

**Tech Stack:** Vite, React 18, TypeScript, three, zustand, vitest, @playwright/test. GO2 변환 도구만 Python(trimesh, pycollada).

**Spec:** `docs/superpowers/specs/2026-10-07-robot-motion-editor-design.md`

## Global Constraints

- fps = **60** 고정. 프레임은 정수.
- CSV: 헤더 없음, 행 = `x,y,z,qx,qy,qz,qw,q1..qN`, 소수 6자리, m/rad. G1 36열, GO2 19열.
- CSV 관절 열 순서 = URDF revolute 등장 순서 (`RobotDef.joints` 순서).
- 루트 채널: `root.x`, `root.y`, `root.z`, `root.roll`, `root.pitch`, `root.yaw`. 오일러 → 쿼터니언은 ZYX(yaw·pitch·roll) 내재 회전, 출력 xyzw.
- 런타임 의존성: `react`, `react-dom`, `three`, `zustand`만. 그 외 추가 금지.
- 파일 쓰기는 `src/fileio.ts`만 경유.
- 색 토큰: `--bg #22262D`, `--panel #2B3038`, `--line #3B424D`, `--text #D5DAE1`, `--accent #F0A43A`, G1 `#58B4D1`, GO2 `#C9D65A`. 서체 IBM Plex Sans KR, 수치 `tabular-nums`. 대문자 라벨·그림자·그라데이션 금지.
- 검증 임계값: 루트 프레임당 위치 > 0.05 m, 회전 > 0.1 rad. 관절 속도 = |Δq|×60 > URDF `velocity`.
- 테스트는 소스 옆 `*.test.ts`, `npx vitest run`.

## Review Focus

1. 기즈모/숫자 입력으로 관절 한계 밖 값 입력 → URDF `lower/upper`로 클램프되어 저장 (Task 7 테스트).
2. 키 이동으로 같은 프레임에 키 두 개 → 이동한 키가 기존 키를 대체, 커브에 중복 프레임 없음 (Task 7 테스트).
3. 루트 yaw 커브가 ±π를 넘나듦 → 쿼터니언 부호 연속, 루트 급변 경고 오탐 없음 (회전 차이는 쿼터니언 각도로 계산) (Task 6 테스트).
4. 키 0개·1개 채널, 클립 길이 밖 프레임 → 기본값/끝값 유지, NaN 없음 (Task 4 테스트).
5. 클립 이름에 `/ \ : * ? " < > |` 또는 중복 이름 → 안전한 파일명, `_2` 접미사 (Task 6 테스트).

---

## 파일 구조

```
package.json, vite.config.ts, tsconfig.json, index.html, playwright.config.ts
public/robots/g1/{model.json, meshes.json}     ← assets/g1-assets 복사
public/robots/go2/{model.json, meshes.json}    ← tools/urdf_to_json.py 출력
tools/urdf_to_json.py
src/main.tsx, src/App.tsx, src/styles.css
src/robot/   types.ts  loadRobot.ts  groups.ts            (+ .test.ts)
src/model/   types.ts  curve.ts  rootMath.ts  evaluate.ts  defaults.ts (+ .test.ts)
src/export/  csv.ts  validate.ts  ExportDialog.tsx        (+ .test.ts)
src/store/   store.ts                                     (+ .test.ts)
src/viewer/  buildRobot.ts  Stage.tsx
src/inspector/Inspector.tsx
src/timeline/ timeScale.ts  TrackCanvas.tsx  graph.ts  GraphCanvas.tsx  Timeline.tsx (+ .test.ts)
src/transport.ts
src/fileio.ts
e2e/smoke.spec.ts
```

---

### Task 1: 프로젝트 골격 + 레이아웃 셸

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `.gitignore`
- Create: `public/robots/g1/model.json`, `public/robots/g1/meshes.json` (복사)

**Interfaces:**
- Produces: `App` — 4영역 그리드(메뉴바 / 프로젝트 · 무대 · 인스펙터 / 타임라인). 영역 id: `#menubar`, `#project`, `#stage`, `#inspector`, `#timeline`.

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts` 후 `npm i three zustand` / `npm i -D vitest @types/three @playwright/test`. `vite.config.ts`에 `test: { environment: 'node' }`. `package.json` scripts: `"test": "vitest run"`, `"e2e": "playwright test"`. `.gitignore`에 `node_modules`, `dist`, `.serena`, `test-results`.
- [ ] **Step 2:** `cp assets/g1-assets/g1_model.json public/robots/g1/model.json`, `cp assets/g1-assets/g1_meshes.json public/robots/g1/meshes.json`.
- [ ] **Step 3:** `styles.css`에 Global Constraints 색 토큰을 `:root` 변수로, `index.html`에 IBM Plex Sans KR (Google Fonts) 링크. `App.tsx`는 CSS grid: 열 `220px 1fr 280px`, 행 `32px 1fr 40%`, 타임라인은 3열 span. 패널 경계 1px `var(--line)`.
- [ ] **Step 4:** `npm run build` → 성공. `npx vitest run --passWithNoTests` → 0 failed.
- [ ] **Step 5:** Commit `chore: scaffold vite react app with layout shell`.

---

### Task 2: RobotDef 로더 (G1)

**Files:**
- Create: `src/robot/types.ts`, `src/robot/loadRobot.ts`, `src/robot/groups.ts`, `src/robot/loadRobot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type RobotKind = 'g1' | 'go2'
  interface JointDef { name: string; parent: string; child: string; xyz: Vec3; rpy: Vec3; axis: Vec3;
                       lower: number; upper: number; velocity: number }
  interface LinkDef  { name: string; mesh: string | null; xyz: Vec3; rpy: Vec3 }
  interface MeshData { positions: Float32Array; indices: Uint32Array }
  interface RobotDef { kind: RobotKind; rootLink: string; links: Record<string, LinkDef>;
                       joints: JointDef[];          // revolute만, URDF 순서 = CSV 순서
                       fixedJoints: Omit<JointDef,'lower'|'upper'|'velocity'>[];
                       meshes: Record<string, MeshData>; standingHeight: number;
                       groups: { name: string; joints: string[] }[] }
  function loadRobotDef(kind: RobotKind, model: unknown, meshes: unknown): RobotDef
  async function fetchRobotDef(kind: RobotKind): Promise<RobotDef>   // /robots/<kind>/*.json
  ```
- 메시 포맷: `pos` = base64 float32 xyz 리틀엔디언, `idx` = base64 uint32, `nv` = 정점 수.
- `standingHeight` = 전 관절 0 자세에서 모든 메시 정점의 최소 z의 부호 반전 (루트 링크 원점 기준).
- 그룹(`groups.ts`): G1 = `왼다리`(left_hip*~left_ankle*), `오른다리`, `허리`(waist_*), `왼팔`(left_shoulder*~left_wrist*), `오른팔`. GO2 = `FL`, `FR`, `RL`, `RR` (접두사). 루트 그룹은 UI에서 별도.

- [ ] **Step 1: 실패 테스트** (`fs`로 `public/robots/g1/*.json` 읽음)
  ```ts
  test('g1 joints: 29 revolute in URDF order', () => {
    const d = loadG1();
    expect(d.joints).toHaveLength(29);
    expect(d.joints[0].name).toBe('left_hip_pitch_joint');
    expect(d.joints[28].name).toBe('right_wrist_yaw_joint');
    expect(d.joints[0].lower).toBeCloseTo(-2.5307);
  });
  test('g1 meshes decode', () => {
    const m = loadG1().meshes['pelvis'];
    expect(m.positions.length).toBe(10620 * 3);
    expect(m.indices.length).toBe(63648);
    expect(m.positions[0]).toBeCloseTo(0.0105, 4);
  });
  test('g1 standing height plausible', () => {
    expect(loadG1().standingHeight).toBeGreaterThan(0.6);
    expect(loadG1().standingHeight).toBeLessThan(0.9);
  });
  test('g1 groups cover all joints exactly once', () => {
    const d = loadG1();
    expect(d.groups.flatMap(g => g.joints).sort()).toEqual(d.joints.map(j => j.name).sort());
  });
  ```
- [ ] **Step 2:** `npx vitest run src/robot` → FAIL (모듈 없음).
- [ ] **Step 3:** 구현. 디코드는 `Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer` → typed array (Node 18+에 `atob` 있음). `standingHeight`는 `rootMath`에 의존하지 않도록 이 파일 안에서 4×4 행렬 FK(링크 원점·rpy 적용)로 계산; Task 5의 `rootMath`와 공유하지 않는다.
- [ ] **Step 4:** `npx vitest run src/robot` → PASS.
- [ ] **Step 5:** Commit `feat(robot): load G1 RobotDef from JSON assets`.

---

### Task 3: GO2 변환 도구

**Files:**
- Create: `tools/urdf_to_json.py`, `tools/README.md`(실행법 3줄)
- Create: `public/robots/go2/model.json`, `public/robots/go2/meshes.json` (생성물 커밋)
- Modify: `src/robot/loadRobot.test.ts` (GO2 테스트 추가)

**Interfaces:**
- Consumes: Task 2의 JSON 포맷 (`g1_model.json`과 동일 키: `name`, `links{mesh,xyz,rpy,scale,color}`, `joints[{name,type,parent,child,xyz,rpy,axis,lower,upper,velocity,effort}]`; 메시 `{nv,pos,idx}`).
- Produces: `python tools/urdf_to_json.py <urdf> <mesh_dir> <out_dir>`.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('go2 joints: 12 revolute, FL first', () => {
    const d = loadGo2();
    expect(d.joints.map(j => j.name).slice(0, 3)).toEqual(['FL_hip_joint','FL_thigh_joint','FL_calf_joint']);
    expect(d.joints).toHaveLength(12);
    expect(Object.keys(d.meshes).length).toBeGreaterThan(0);
    expect(d.standingHeight).toBeGreaterThan(0.2);
  });
  ```
- [ ] **Step 2:** `npx vitest run src/robot` → FAIL (파일 없음).
- [ ] **Step 3:** 원본 받기: `git clone --depth 1 --filter=blob:none --sparse https://github.com/unitreerobotics/unitree_ros <scratch>/unitree_ros && git -C <scratch>/unitree_ros sparse-checkout set robots/go2_description`. 메시는 `robots/go2_description/dae/*.dae`, URDF의 `package://go2_description/dae/X.dae` → `<mesh_dir>/X.dae`.
- [ ] **Step 4:** `urdf_to_json.py` 구현: `xml.etree`로 URDF 파싱(visual origin → link `xyz/rpy`, mesh 이름 = 파일 stem), `trimesh.load(path, force='mesh')`로 DAE 로드(씬이면 `dump(concatenate=True)`), `pos`=float32 / `idx`=uint32 base64. 의존성은 `pip install trimesh pycollada numpy` (도구 전용, README에 명시).
- [ ] **Step 5:** 실행 → `public/robots/go2/` 생성. `npx vitest run src/robot` → PASS.
- [ ] **Step 6:** Commit `feat(tools): convert GO2 URDF+DAE to RobotDef JSON`.

---

### Task 4: 커브 평가

**Files:**
- Create: `src/model/types.ts`, `src/model/curve.ts`, `src/model/curve.test.ts`

**Interfaces:**
- Produces (`types.ts`, 스펙 4절 그대로):
  ```ts
  type Interp = 'linear' | 'bezier' | 'hold'
  interface Tan { df: number; dv: number }
  interface Key { f: number; v: number; interp: Interp; inTan: Tan; outTan: Tan }
  interface Curve { keys: Key[] }
  interface Clip { id: string; name: string; robot: RobotKind; length: number; channels: Record<string, Curve> }
  interface Actor { id: string; name: string; robot: RobotKind; color: string; placement: { x: number; y: number; yaw: number } }
  interface Item { id: string; refId: string; start: number; trimIn: number; trimOut: number }
  interface Track { id: string; kind: 'video' | 'motion'; actorId?: string; hidden: boolean; locked: boolean; items: Item[] }
  interface Sequence { tracks: Track[]; markers: { f: number; name: string }[]; inF: number | null; outF: number | null }
  interface Project { version: 1; fps: 60; actors: Actor[]; clips: Record<string, Clip>; media: []; sequence: Sequence }
  ```
- Produces (`curve.ts`):
  ```ts
  function evalCurve(c: Curve, f: number, fallback: number): number
  function makeKey(f: number, v: number, interp?: Interp): Key   // 기본 interp 'bezier', inTan {df:-10,dv:0}, outTan {df:10,dv:0}
  ```
- 의미: 키 0개 → `fallback`. f < 첫 키 → 첫 키 값, f > 마지막 키 → 마지막 키 값. 구간 [k0,k1]은 `k0.interp`로: `hold` → k0.v, `linear` → 선형, `bezier` → 3차 베지어 P0=(f0,v0), P1=(f0+out.df, v0+out.dv), P2=(f1+in.df, v1+in.dv), P3=(f1,v1). 핸들 df는 [0, f1−f0]로 클램프(x 단조 보장)하고 dv는 같은 비율로 스케일. x(s)=f를 이분법 30회로 풀어 y(s) 반환.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('empty → fallback', () => expect(evalCurve({ keys: [] }, 5, 0.7)).toBe(0.7));
  test('single key constant', () => expect(evalCurve({ keys: [makeKey(10, 2)] }, 0, 0)).toBe(2));
  test('linear midpoint', () => expect(evalCurve({ keys: [makeKey(0,0,'linear'), makeKey(10,1)] }, 5, 0)).toBeCloseTo(0.5));
  test('hold', () => expect(evalCurve({ keys: [makeKey(0,0,'hold'), makeKey(10,1)] }, 9, 0)).toBe(0));
  test('bezier flat tangents: ends exact, mid 0.5, symmetric ease', () => {
    const c = { keys: [makeKey(0,0), makeKey(30,1)] };
    expect(evalCurve(c, 0, 0)).toBeCloseTo(0); expect(evalCurve(c, 30, 0)).toBeCloseTo(1);
    expect(evalCurve(c, 15, 0)).toBeCloseTo(0.5, 3);
    expect(evalCurve(c, 3, 0)).toBeLessThan(0.1);   // 이즈 인
  });
  test('past last key holds last', () => expect(evalCurve({ keys: [makeKey(0,0), makeKey(10,1)] }, 99, 0)).toBe(1));
  test('oversized handle clamped, no NaN', () => {
    const k0 = { ...makeKey(0,0), outTan: { df: 500, dv: 50 } };
    const v = evalCurve({ keys: [k0, makeKey(10,1)] }, 5, 0);
    expect(Number.isFinite(v)).toBe(true);
  });
  ```
- [ ] **Step 2:** `npx vitest run src/model/curve` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(model): curve evaluation (linear/hold/bezier)`.

---

### Task 5: 루트 수학 + evaluate + 기본 프로젝트

**Files:**
- Create: `src/model/rootMath.ts`, `src/model/evaluate.ts`, `src/model/defaults.ts`, `src/model/evaluate.test.ts`

**Interfaces:**
- Consumes: `evalCurve` (Task 4), `RobotDef` (Task 2).
- Produces:
  ```ts
  type Vec3 = [number, number, number]; type Quat = [number, number, number, number] // xyzw
  function eulerToQuat(roll: number, pitch: number, yaw: number): Quat     // ZYX 내재
  function quatYaw(q: Quat): number
  function quatMul(a: Quat, b: Quat): Quat
  function quatAngle(a: Quat, b: Quat): number                              // 0..π
  function yawQuat(yaw: number): Quat
  interface Pose { rootPos: Vec3; rootQuat: Quat; q: number[] }             // q = RobotDef.joints 순서
  type RobotDefs = Record<RobotKind, RobotDef>
  function evaluateClip(clip: Clip, def: RobotDef, clipFrame: number): Pose  // 클립 로컬
  function evaluate(p: Project, defs: RobotDefs, actorId: string, frame: number): Pose  // 무대 월드
  function newProject(): Project      // G1 #1 (placement 0,0,0) + GO2 #1 (placement x=1.5) 각 클립 1개(length 120)·트랙 1개·Item 1개
  function addActor(p: Project, robot: RobotKind): Project   // 새 액터 + 클립 + 트랙 + Item, 이름 "G1 #2" 식
  ```
- `evaluateClip`: 채널 없는 관절 → 0, `root.z` 없으면 `def.standingHeight`, 나머지 루트 → 0.
- `evaluate` (M1): 액터의 모션 트랙에서 `start ≤ frame < start + (trimOut − trimIn)`인 Item을 찾아 `clipFrame = frame − start + trimIn`. 없으면 가장 가까운 Item의 경계 프레임으로 클램프(빈 구간 = 직전/첫 포즈 유지). 월드 변환: `pos = Rz(yaw_p)·(x,y) + (px,py)`, z 유지; `quat = yawQuat(yaw_p) ⊗ clipQuat`.
- ID는 `crypto.randomUUID()`.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('euler→quat yaw 90°', () => expectQuat(eulerToQuat(0,0,Math.PI/2), [0,0,Math.SQRT1_2,Math.SQRT1_2]));
  test('quatYaw roundtrip', () => expect(quatYaw(eulerToQuat(0.1,0.2,2.5))).toBeCloseTo(2.5));
  test('empty clip pose: zeros, root z = standingHeight', () => {
    const p = evaluateClip(emptyClip('g1'), g1, 0);
    expect(p.q).toHaveLength(29); expect(p.q.every(v => v === 0)).toBe(true);
    expect(p.rootPos[2]).toBeCloseTo(g1.standingHeight);
  });
  test('placement applied: yaw 90° maps clip +x to world +y', () => {
    const proj = projectWithRootX(1.0, { x: 2, y: 0, yaw: Math.PI/2 });
    const pose = evaluate(proj, defs, actorId, 0);
    expect(pose.rootPos[0]).toBeCloseTo(2); expect(pose.rootPos[1]).toBeCloseTo(1);
  });
  test('frame after item end holds last pose', () => { /* frame = length+30 → clip frame length-1 값 */ });
  test('newProject has G1 and GO2 actors with one item each', () => {
    const p = newProject();
    expect(p.actors.map(a => a.robot)).toEqual(['g1','go2']);
    expect(p.sequence.tracks.filter(t => t.kind === 'motion').every(t => t.items.length === 1)).toBe(true);
  });
  ```
- [ ] **Step 2:** FAIL 확인. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(model): evaluate pose with placement, default project`.

---

### Task 6: CSV 내보내기 + 검증

**Files:**
- Create: `src/export/csv.ts`, `src/export/validate.ts`, `src/export/csv.test.ts`, `src/export/validate.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `quatMul`, `quatYaw`, `yawQuat`, `quatAngle` (Task 5).
- Produces:
  ```ts
  type RootMode = 'local' | 'world'
  function itemFrameRange(item: Item): { from: number; to: number }        // to 미포함, 길이 = trimOut − trimIn
  function samplePoses(p: Project, defs: RobotDefs, actorId: string, itemId: string, mode: RootMode): Pose[]
  function posesToCsv(poses: Pose[]): string                               // '\n' 구분, 마지막 줄바꿈 포함
  function csvFileName(p: Project, actorId: string, itemId: string, taken: Set<string>): string
  interface Warning { kind: 'jointLimit' | 'jointVelocity' | 'rootJump' | 'gap'; frame: number; channel: string; message: string }
  function validatePoses(poses: Pose[], def: RobotDef, firstFrame: number): Warning[]
  ```
- `samplePoses`: 매 프레임 `evaluate`. 쿼터니언 정규화 후, 이전 프레임과 내적 < 0이면 부호 반전. `local`: 첫 프레임 `p0`, `yaw0 = quatYaw(q0)`; 각 프레임 `pos' = Rz(−yaw0)·(pos − p0)` (z는 원래 z 유지), `quat' = yawQuat(−yaw0) ⊗ quat`.
- `csvFileName`: `<접두>_<클립이름>.csv`, 접두 = 같은 로봇 액터가 1개면 `G1`/`GO2`, 여러 개면 액터 이름. 이름의 `/\:*?"<>|` 및 공백 → `_`. `taken`에 있으면 `_2`, `_3`… 반환 전 `taken`에 추가.
- `validatePoses`: 관절 한계(`q < lower || q > upper`), 속도(`|q[i]−q[i-1]|·60 > velocity`), 루트 급변(`|Δpos| > 0.05` 또는 `quatAngle > 0.1`). 같은 종류·채널의 연속 프레임은 첫 프레임 한 번만 경고. `gap`은 M1에서 Item 범위가 곧 클립이라 발생하지 않음 — 타입만 둔다.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('g1 csv: 36 cols, rows = item length, 6 decimals, no header', () => {
    const csv = posesToCsv(samplePoses(proj, defs, g1Actor, g1Item, 'world'));
    const rows = csv.trimEnd().split('\n');
    expect(rows).toHaveLength(120);
    expect(rows[0].split(',')).toHaveLength(36);
    expect(rows[0].split(',')[0]).toMatch(/^-?\d+\.\d{6}$/);
  });
  test('go2 csv: 19 cols', () => { /* 동일, 19 */ });
  test('local mode: first row x=y=0, yaw=0', () => {
    const poses = samplePoses(projWithPlacement({ x: 3, y: -2, yaw: 1.2 }), defs, a, i, 'local');
    expect(poses[0].rootPos[0]).toBeCloseTo(0); expect(poses[0].rootPos[1]).toBeCloseTo(0);
    expect(quatYaw(poses[0].rootQuat)).toBeCloseTo(0);
  });
  test('quat sign continuous across yaw ±π', () => {
    const poses = samplePoses(projWithYawKeys([[0, 3.0], [60, 3.3]]), defs, a, i, 'world');
    for (let k = 1; k < poses.length; k++) expect(dot(poses[k-1].rootQuat, poses[k].rootQuat)).toBeGreaterThan(0);
  });
  test('no rootJump warning for smooth yaw crossing π', () => {
    expect(validatePoses(posesCrossingPi, g1, 0).filter(w => w.kind === 'rootJump')).toEqual([]);
  });
  test('joint limit and velocity warnings', () => {
    const w = validatePoses(posesWithKneeAt(-1.0 /* < lower */, frame=10), g1, 0);
    expect(w.some(x => x.kind === 'jointLimit' && x.channel === 'left_knee_joint' && x.frame === 10)).toBe(true);
  });
  test('file names: sanitize and dedupe', () => {
    const taken = new Set<string>();
    expect(csvFileName(projClipNamed('walk/01'), g1Actor, g1Item, taken)).toBe('G1_walk_01.csv');
    expect(csvFileName(projClipNamed('walk/01'), g1Actor, g1Item, taken)).toBe('G1_walk_01_2.csv');
  });
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(export): clip CSV export with local/world root and validation`.

---

### Task 7: 스토어 (상태 + 편집 액션 + 실행취소)

**Files:**
- Create: `src/store/store.ts`, `src/store/store.test.ts`

**Interfaces:**
- Consumes: `newProject`, `addActor`, `makeKey`, `RobotDefs`.
- Produces (`useEditor` = zustand store; 테스트는 `createEditorStore(defs)` 팩토리로):
  ```ts
  interface Selection { actorId: string | null; channel: string | null; keys: { channel: string; f: number }[] }
  interface EditorState {
    defs: RobotDefs; project: Project; frame: number; playing: boolean; autoKey: boolean;
    view: 'tracks' | 'graph'; sel: Selection;
    setFrame(f: number): void; setPlaying(b: boolean): void; toggleAutoKey(): void; setView(v): void;
    select(actorId: string | null, channel?: string | null): void; selectKeys(keys, additive: boolean): void;
    setValue(actorId: string, channel: string, v: number): void   // autoKey면 현재 프레임에 키, 아니면 무시
    setKey(clipId: string, channel: string, f: number, v: number): void
    deleteKeys(clipId: string, keys: { channel: string; f: number }[]): void
    moveKeys(clipId: string, keys: { channel: string; f: number }[], df: number): void
    setInterp(clipId: string, keys: { channel: string; f: number }[], interp: Interp): void
    setTangent(clipId: string, channel: string, f: number, side: 'in' | 'out', t: Tan, linked: boolean): void
    keyGroup(actorId: string, group: string): void                // 그룹 전체 관절 현재 값으로 키
    setPlacement(actorId: string, pl: Partial<Actor['placement']>): void
    addActor(robot: RobotKind): void
    undo(): void; redo(): void
  }
  ```
- 프로젝트를 바꾸는 액션은 바꾸기 전 `structuredClone(project)`를 undo 스택(최대 200)에 넣고 redo 스택을 비운다. `setFrame`/선택/재생은 스택에 안 넣음.
- `setKey`: 관절 채널이면 `def.joints`의 `lower/upper`로 클램프. 같은 f 키가 있으면 값만 교체(보간·탄젠트 유지). f는 `Math.round`, [0, clip.length−1] 클램프. 키 배열 f 정렬 유지.
- `moveKeys`: 이동 후 같은 프레임에 이동 안 한 키가 있으면 그 키 삭제(이동한 키 우선).
- `setInterp`: UI의 "이즈"는 `'bezier'` + 양쪽 탄젠트 `dv = 0`으로 리셋, "선형"/"홀드"는 interp만 변경.
- `setTangent` linked: 반대쪽 핸들을 같은 기울기(dv/df)로 맞추고 길이는 유지.
- 액터의 클립 = 그 액터 트랙 첫 Item의 `refId` (M1).

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('setKey clamps to joint limits', () => {
    s.setKey(g1Clip, 'left_knee_joint', 0, 99);
    expect(keyAt(g1Clip, 'left_knee_joint', 0).v).toBeCloseTo(2.9671);
  });
  test('setKey on existing frame replaces value only', () => { /* interp 'hold' 유지 확인 */ });
  test('moveKeys onto existing key replaces it', () => {
    s.setKey(c, ch, 0, 1); s.setKey(c, ch, 10, 2);
    s.moveKeys(c, [{ channel: ch, f: 0 }], 10);
    expect(curve(c, ch).keys.map(k => [k.f, k.v])).toEqual([[10, 1]]);
  });
  test('setValue with autoKey off does not create key', () => { /* … */ });
  test('undo/redo restores project', () => {
    s.setKey(c, ch, 5, 1); s.undo(); expect(curve(c, ch).keys).toHaveLength(0);
    s.redo(); expect(curve(c, ch).keys).toHaveLength(1);
  });
  test('linked tangent mirrors slope', () => {
    s.setTangent(c, ch, 5, 'out', { df: 10, dv: 2 }, true);
    const k = keyAt(c, ch, 5); expect(k.inTan.dv / k.inTan.df).toBeCloseTo(0.2);
  });
  test('keyGroup keys every joint of group', () => { /* 왼팔 7관절 키 생성 */ });
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(store): editor state, key editing actions, undo`.

---

### Task 8: 무대 뷰어

**Files:**
- Create: `src/viewer/buildRobot.ts`, `src/viewer/buildRobot.test.ts`, `src/viewer/Stage.tsx`
- Modify: `src/App.tsx` (`#stage`에 `<Stage/>`, 앱 시작 시 `fetchRobotDef('g1')`, `fetchRobotDef('go2')` 후 스토어 생성)

**Interfaces:**
- Consumes: `RobotDef`, `Pose`, `evaluate`, `useEditor`.
- Produces:
  ```ts
  interface RobotRig { root: THREE.Group; jointPivots: Record<string, THREE.Object3D>; linkToJoint: Map<THREE.Object3D, string>;
                       applyPose(pose: Pose): void; setGhost(on: boolean): void; setColor(hex: string): void }
  function buildRobot(def: RobotDef, color: string): RobotRig
  function pivotAngle(pivot: THREE.Object3D, axis: Vec3): number   // 기즈모 회전 후 관절각 읽기
  ```
- 리그 구조: 링크마다 Group, 관절마다 `origin(xyz,rpy)` Group → pivot Group(관절 축 회전) → 자식 링크. 메시는 `BufferGeometry`(positions, indices, `computeVertexNormals`), 재질 `MeshStandardMaterial({ color })`. 고스트 = `transparent, opacity 0.25, depthWrite false`. Three 좌표는 Z-up 유지(`camera.up = (0,0,1)`).
- Stage: 렌더러 1개, `OrbitControls`, 바닥 = 0.5 m 그리드 + 1 m 굵은 선(색 `--line`), 액터별 루트 궤적 = 클립 전 프레임 `evaluate` 결과의 (x,y,0.002) `Line`(액터 색) + 현재 프레임 점. 단축키 `1/3/7` = 정면/측면/탑 (`Stage`에 포커스 있을 때).
- 선택: 레이캐스트로 메시 → `linkToJoint`(링크의 부모 관절, 루트 링크면 `'root'`) → `select(actorId, channel)`. 선택 관절 pivot에 `TransformControls`(mode `rotate`, space `local`, 관절 축 성분만 `showX/Y/Z`). `objectChange` → `pivotAngle` → `setValue`. 루트 선택 시 `TransformControls` translate/rotate(`R` 키 토글) → `root.x/y/z/roll/pitch/yaw` `setValue`.
- 매 프레임(스토어 구독) 각 액터 `applyPose(evaluate(...))`. 선택된 액터 외 다른 액터는 고스트 아님(M1은 클립 보기 = 무대 동일; 고스트는 `setGhost` API만 노출).

- [ ] **Step 1: 실패 테스트** (`three`는 Node에서 WebGL 없이 Object3D 계산 가능)
  ```ts
  test('zero pose: left foot below pelvis by ~standingHeight', () => {
    const rig = buildRobot(g1, '#58B4D1'); rig.applyPose(zeroPose(g1));
    const foot = worldPos(rig, 'left_ankle_roll_link');
    expect(foot.z).toBeLessThan(-0.6);
  });
  test('pivotAngle reads back applied angle', () => {
    const rig = buildRobot(g1, '#fff'); rig.applyPose(poseWith(g1, 'left_elbow_joint', 0.8));
    expect(pivotAngle(rig.jointPivots['left_elbow_joint'], [0,1,0])).toBeCloseTo(0.8);
  });
  ```
- [ ] **Step 2:** FAIL. **Step 3:** `buildRobot` 구현 → PASS. **Step 4:** `Stage.tsx` 구현.
- [ ] **Step 5:** `npm run dev` → 브라우저에서 G1·GO2가 1.5 m 간격으로 서 있고, 링크 클릭 시 회전 링 표시, 드래그 시 관절이 한계 안에서 회전(자동 키 켬). Playwright MCP 스크린샷으로 확인.
- [ ] **Step 6:** Commit `feat(viewer): stage with robots, trails, joint gizmo`.

---

### Task 9: 인스펙터

**Files:**
- Create: `src/inspector/Inspector.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useEditor` (`sel`, `setValue`, `setKey`, `deleteKeys`, `setInterp`, `keyGroup`, `setPlacement`), `evaluate`.
- 내용(위→아래): 선택 액터 이름·색(`<input type="color">`) · 배치 x/y/yaw 숫자 입력 · 선택 채널 슬라이더(`<input type="range">` min=lower max=upper step 0.001) + 숫자 입력 + 도/rad 토글 · 한계 10% 이내면 슬라이더 트랙 `--accent` · 이전/다음 키(◀◆▶), 키 추가/삭제 · 선택 키 보간 `<select>`(선형/이즈/홀드) · 그룹 버튼 "<그룹> 전체 키".
- 선택이 없으면 "무대에서 링크를 클릭하거나 타임라인에서 채널을 고르세요." 한 줄.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `npm run dev`에서 확인: 슬라이더 이동 → 무대 관절 회전, 자동 키 꺼짐이면 키 생성 안 됨, "키 추가" → 키 생성, 숫자 입력 99 → 한계값으로 표시.
- [ ] **Step 3:** Commit `feat(inspector): joint sliders, placement, key controls`.

---

### Task 10: 타임라인 — 트랙 보기 + 트랜스포트

**Files:**
- Create: `src/timeline/timeScale.ts`, `src/timeline/timeScale.test.ts`, `src/timeline/TrackCanvas.tsx`, `src/timeline/Timeline.tsx`, `src/transport.ts`
- Modify: `src/App.tsx` (`#timeline`, 메뉴바에 재생 버튼·타임코드·자동 키 토글)

**Interfaces:**
- Produces:
  ```ts
  interface TimeScale { x0: number; pxPerFrame: number }
  function frameToX(s: TimeScale, f: number): number
  function xToFrame(s: TimeScale, x: number): number                 // 반올림 정수
  function formatTimecode(f: number): string                         // 'MM:SS.ff', ff = 프레임 0..59
  interface Row { kind: 'group' | 'channel'; actorId: string; label: string; channels: string[]; expanded?: boolean }
  function buildRows(p: Project, defs: RobotDefs, expanded: Set<string>): Row[]   // 액터마다: 루트 그룹(6채널), 관절 그룹들
  function hitKey(rows: Row[], clip: Clip, s: TimeScale, rowH: number, x: number, y: number): { channel: string; f: number }[] | null
  function startTransport(): () => void   // rAF 루프: playing이면 경과시간×60 프레임 진행, 클립 끝에서 0으로 루프. 반환 = 정지
  ```
- 캔버스: 행 높이 20px, 좌측 라벨 160px, 상단 눈금자 24px(1초 굵은 눈금 + 타임코드). 키 = 마름모 7px(기본 `--text`, 선택 `--accent`), 그룹 행 = 하위 키 합집합 요약 키. 재생헤드 = `--accent` 세로선. 휠 = 가로 스크롤, Ctrl+휠 = 줌.
- 마우스: 빈 곳 클릭/눈금자 드래그 = `setFrame`, 키 클릭 = 선택(Shift 추가), 빈 곳 드래그 = 박스 선택, 선택 키 드래그 = `moveKeys`(놓을 때 1회), 우클릭 = 보간 메뉴(선형/이즈/홀드), Delete = `deleteKeys`, Ctrl+C/V = 재생헤드 기준 복사/붙여넣기(그 채널들), 라벨 클릭 = 그룹 펼치기/채널 선택.
- 전역 단축키(`transport.ts`): Space 재생/정지, ←/→ ±1, Shift+←/→ ±10, Ctrl+Z / Ctrl+Shift+Z, Tab = 트랙⇄그래프. 입력 요소에 포커스 있으면 무시.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('frame↔x roundtrip', () => { const s = { x0: 160, pxPerFrame: 4 }; expect(xToFrame(s, frameToX(s, 37))).toBe(37); });
  test('timecode', () => { expect(formatTimecode(0)).toBe('00:00.00'); expect(formatTimecode(61)).toBe('00:01.01'); expect(formatTimecode(3600)).toBe('01:00.00'); });
  test('rows: g1 = root + 5 groups collapsed', () => {
    expect(buildRows(newProjectG1Only(), defs, new Set()).map(r => r.label)).toEqual(['G1 #1','루트','왼다리','오른다리','허리','왼팔','오른팔']);
  });
  test('hitKey finds key within 4px', () => { /* 루트 그룹 펼침, root.x 키 f=10 → 해당 좌표 ±3px 클릭 → 히트 */ });
  ```
  (액터 이름 행은 `kind: 'group'`, `channels: []`.)
- [ ] **Step 2:** FAIL. **Step 3:** `timeScale.ts` 구현 → PASS. **Step 4:** 캔버스·트랜스포트 구현.
- [ ] **Step 5:** `npm run dev` 확인: Space 재생 시 두 로봇 동시 재생, 키 드래그·삭제·보간 변경이 무대에 반영, Ctrl+Z 복구.
- [ ] **Step 6:** Commit `feat(timeline): track view, keys editing, transport shortcuts`.

---

### Task 11: 그래프 에디터

**Files:**
- Create: `src/timeline/graph.ts`, `src/timeline/graph.test.ts`, `src/timeline/GraphCanvas.tsx`
- Modify: `src/timeline/Timeline.tsx` (view `'graph'`일 때 `GraphCanvas`)

**Interfaces:**
- Consumes: `evalCurve`, `setKey`, `moveKeys`, `setTangent`, `TimeScale`.
- Produces:
  ```ts
  interface ValueScale { y0: number; pxPerUnit: number }   // 위로 증가
  function fitView(curves: Curve[], limits: { lower: number; upper: number }[], fromF: number, toF: number, h: number): ValueScale
  function velocityViolations(c: Curve, velocity: number, fromF: number, toF: number): { from: number; to: number }[]  // |v(f+1)−v(f)|·60 > velocity 인 연속 구간
  function handlePoints(k: Key, s: TimeScale, vs: ValueScale): { in: [number, number]; out: [number, number] }
  ```
- 표시: 선택 채널들(`sel.channel` 또는 선택 그룹 채널, 최대 8개) 커브를 프레임 단위 샘플 폴리라인으로, 채널별 색(고정 8색 팔레트, 서로 구분되는 명도). URDF 한계 가로 점선, 속도 위반 구간 빨간(`#E5484D`) 굵은 선 덧칠. 키 = 사각 6px, 선택 키에 베지어 핸들(원 5px + 선).
- 조작: 키 드래그 = 시간(`moveKeys`)+값(`setKey`), 핸들 드래그 = `setTangent(linked = !altKey)`, F = `fitView`, 휠/Ctrl+휠 = 트랙 보기와 동일.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('velocityViolations detects steep segment', () => {
    const c = { keys: [makeKey(0,0,'linear'), makeKey(2,2)] };   // 1 rad/frame = 60 rad/s
    expect(velocityViolations(c, 32, 0, 10)).toEqual([{ from: 0, to: 2 }]);
  });
  test('no violation for slow curve', () => expect(velocityViolations({ keys: [makeKey(0,0,'linear'), makeKey(60,1)] }, 32, 0, 60)).toEqual([]));
  test('fitView includes limits', () => {
    const vs = fitView([{ keys: [makeKey(0,0)] }], [{ lower: -1, upper: 2 }], 0, 60, 300);
    expect(vs.y0 - 2 * vs.pxPerUnit).toBeGreaterThanOrEqual(0);
  });
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현 → PASS. **Step 4:** `GraphCanvas` 구현.
- [ ] **Step 5:** `npm run dev` 확인: Tab으로 전환, 핸들 드래그 시 무대 동작 곡선 변화, Alt 드래그로 핸들 분리.
- [ ] **Step 6:** Commit `feat(timeline): graph editor with bezier handles and velocity marks`.

---

### Task 12: 파일 입출력 + 내보내기 대화상자

**Files:**
- Create: `src/fileio.ts`, `src/export/ExportDialog.tsx`
- Modify: `src/App.tsx` (메뉴 "내보내기", "액터+ G1 / GO2")

**Interfaces:**
- Consumes: `samplePoses`, `posesToCsv`, `csvFileName`, `validatePoses`, `useEditor`.
- Produces:
  ```ts
  // fileio.ts — 래퍼 교체 지점. 여기 외에서 파일 API 호출 금지.
  async function pickDirectory(): Promise<FileSystemDirectoryHandle | null>   // 미지원/취소 → null
  async function writeTextFiles(dir: FileSystemDirectoryHandle | null, files: { name: string; text: string }[]): Promise<void>
  // dir == null 이면 파일마다 <a download> 폴백
  ```
- 대화상자(`<dialog>`): 액터별 Item 체크박스(이름, 시작–끝 타임코드, 프레임 수), 루트 라디오(로컬 기본/월드), "폴더 선택"(선택 폴더 이름 표시), 경고 목록(종류·프레임·채널·메시지; 클릭 → `setFrame(frame)` + `select(actor, channel)` 후 대화상자 닫음), 버튼 "내보내기"(경고 있으면 라벨 "경고 N개 무시하고 내보내기"). 완료 시 "CSV N개를 내보냈습니다." 표시.
- 경고는 선택 항목이 바뀔 때 다시 계산.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `npm run dev` 확인: 무릎을 한계 근처에서 급하게 움직인 키 → 경고 표시 → 클릭 시 해당 프레임 이동 → 내보내기 → 폴더에 `G1_<클립>.csv`, `GO2_<클립>.csv` 생성, 열 수 36/19.
- [ ] **Step 3:** Commit `feat(export): export dialog and fileio seam`.

---

### Task 13: E2E 스모크

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- 앱은 테스트용으로 `window.__editor = useEditor` 노출 (`import.meta.env.DEV`에서만).
- 내보내기 검증은 `<a download>` 폴백 경로 사용(`showDirectoryPicker` 없는 컨텍스트) → Playwright `page.waitForEvent('download')`.

- [ ] **Step 1: 테스트**
  ```ts
  test('load both robots, key, export CSV', async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).showDirectoryPicker; });
    await page.goto('/');
    await expect(page.locator('#stage canvas')).toBeVisible();
    await page.evaluate(() => { const s = (window as any).__editor.getState();
      s.toggleAutoKey(); s.select(s.project.actors[0].id, 'left_elbow_joint'); s.setFrame(30);
      s.setValue(s.project.actors[0].id, 'left_elbow_joint', 1.0); });
    await page.getByRole('button', { name: '내보내기' }).click();
    const downloads = [page.waitForEvent('download'), page.waitForEvent('download')];
    await page.getByRole('button', { name: /내보내기$/ }).last().click();
    const files = await Promise.all(downloads);
    const texts = await Promise.all(files.map(async d => (await import('fs')).readFileSync(await d.path(), 'utf8')));
    const cols = texts.map(t => t.split('\n')[0].split(',').length).sort();
    expect(cols).toEqual([19, 36]);
    const g1 = texts.find(t => t.split('\n')[0].split(',').length === 36)!;
    expect(Number(g1.split('\n')[30].split(',')[7 + 18])).toBeCloseTo(1.0, 5);  // left_elbow_joint = 관절 index 18
  });
  ```
- [ ] **Step 2:** `npx playwright install chromium && npm run e2e` → PASS (config `webServer: npm run dev`, port 5173).
- [ ] **Step 3:** `npx vitest run` 전체 PASS, `npm run build` 성공.
- [ ] **Step 4:** Commit `test(e2e): smoke test for load, key, export`.
