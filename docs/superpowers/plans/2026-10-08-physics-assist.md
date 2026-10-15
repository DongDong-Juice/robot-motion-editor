# MuJoCo 물리 검증 (골반 보조력 지표) Implementation Plan

> **상태 (2026-10-12):** 완료 · `master` 머지됨. 아래 체크박스는 작업 중 갱신하지 않았음 — 진행 기록은 git 이력을 볼 것.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시퀀스 조각을 MuJoCo WASM(관절 PD 500 Hz + 골반 보조 렌치)으로 시뮬레이션해서 프레임별 "체중 대비 보조력 %"를 타임라인에 그리고, 내보내기 경고 목록에 넣는다.

**Architecture:** 순수 계산(`control.ts`·`segments.ts`·`settings.ts`)과 MuJoCo 래퍼(`sim.ts`, Node·워커 공용)를 나누고, 워커(`worker.ts`)가 큐 순차 실행, 메인은 `client.ts`(워커 관리)와 `physicsStore.ts`(결과·진행률, 저장 안 함)만 본다. 입력은 항상 `exportItemCsv(..., 'local').text`를 파싱한 행 → 화면 결과 = 내보내기 검사 결과. 설정은 `project.physics`(저장·실행취소).

**Tech Stack:** 기존 + `@mujoco/mujoco@3.15.0` (런타임 의존성 첫 예외, 지연 로딩 청크).

**Spec:** `docs/superpowers/specs/2026-10-08-physics-assist-design.md`. 스파이크 원본: `docs/superpowers/spikes/mujoco-sim.mjs` (API 사용법·변환·보조 렌치 계산의 기준 코드. 이 계획의 코드 조각은 여기서 옮긴 것).

## Global Constraints

- 기존 제약 전부 유지 (60fps, CSV 형식, 파일 API는 `fileio.ts`만, `edit(fn, touched)`·dev freeze, `tryEdit`, 프로젝트 변경 = dirty, 토큰·서체, 한국어 문구, 트랙 잠금 규칙).
- 의존성은 `@mujoco/mujoco@3.15.0` 하나만 추가 (버전 고정, `^` 없이).
- wasm·메시는 첫 화면 번들에 들어가지 않는다: `@mujoco/mujoco`는 `worker.ts`에서만 import, 메시는 `public/physics/<robot>/`에서 fetch.
- 메시 쓰기는 `mj.FS.mkdirTree` + `mj.FS.writeFile`만 (`MjVFS.addBuffer` 금지 — 19 MB에 17–75 s).
- 결정성: 같은 행·설정 → 비트 동일 결과. `Math.random`, `Date.now`, `performance.now`를 결과 계산에 쓰지 않는다 (진행률 표시에는 허용).
- 시뮬 상수: `DT = 0.002`, 정착 0.2 s, 보조 렌치 상한 `FMAX = 4000 N`, `TMAX = 600 Nm`, 경고 구간 3프레임 미만 무시·6프레임 이하 간격 병합.
- 쿼터니언: CSV `xyzw` → MuJoCo `qpos[3..6] = wxyz`. freejoint `qvel[0..2]` 월드 선속도, `qvel[3..5]` 로컬 각속도. 토크는 `xmat`(로컬→월드)로 돌려 `xfrc_applied`에 쓴다.
- 보조 감쇠는 목표 속도 기준: `F = kpF(p_ref−p) + kdF(v_ref−v)`, `T = kpT·rotErr + kdT(ω_ref−ω)` (스파이크의 `−kd·v`와 다름. `v_ref`=루트 위치 차분×60, `ω_ref`=인접 프레임 쿼터니언 차의 로컬 회전벡터×60).
- 표시 문구에 "참고 지표 (RL 정책 결과와 다를 수 있음)".
- **스펙과의 차이 (계획에서 확정)**: G1 그룹은 스펙의 "다리 hip·knee 두 값"을 그대로 표현하려고 5개로 나눈다 — `고관절 100/2`, `무릎 150/4`, `발목 40/2`, `허리 200/5`, `팔 40/1`. GO2는 `전체 20/0.5`.

## Review Focus

1. 같은 조각의 결과가 화면·내보내기 경고에서 같은 프레임 범위로 나오는지 (입력이 둘 다 `exportItemCsv` 'local' 텍스트) (Task 3, 7).
2. 결정성 테스트가 실제로 비트 비교인지 (Float32Array 바이트 비교) (Task 3).
3. 편집·설정 변경 → 결과 stale, stale은 그래프 회색·내보내기 때 재검증 (Task 4, 5, 7).
4. 워커 취소·대체가 오래된 결과를 스토어에 쓰지 않는지 (요청 id 비교) (Task 4).
5. 첫 화면 번들에 mujoco wasm이 없는지 (`vite build` 산출물 확인) (Task 1).

---

### Task 1: G1 모델 파일 + 로더 + 브라우저 실측 게이트

**Files:** Add `public/physics/g1/scene.xml`, `public/physics/g1/meshes/*`; Add `src/physics/sim.ts`(로더 부분만); Add `src/physics/worker.ts`(임시 `bench` 메시지만); Modify `package.json`, `vite.config.ts`(필요 시)

**원본:** `D:/Project/00_ROS/G1_motion_editor_인수인계_20261002/02_g1/g1-motion-editor/mujoco/` 의 `g1_scene.xml` → `public/physics/g1/scene.xml`, `meshes/` 전체 복사. (다른 컴퓨터에 원본이 없으면 이 저장소에 커밋된 사본을 쓴다.) scene.xml 안의 include·meshdir 경로가 `meshes/`를 가리키는지 확인하고, include된 xml이 있으면 함께 복사.

**Interfaces:**
```ts
// src/physics/sim.ts
export type Robot = 'g1' | 'go2'
export interface ModelFiles { scene: Uint8Array; meshes: { name: string; data: Uint8Array }[] }
export interface Loaded { mj: any; m: any; d: any; robot: Robot }
export async function loadModel(mj: any, robot: Robot, files: ModelFiles): Promise<Loaded>
// FS.mkdirTree(`/${robot}/meshes`), FS.writeFile 각 메시, scene → `/${robot}/scene.xml`,
// m = mj.MjModel.from_xml_path(...), m.opt.timestep = 0.002, d = new mj.MjData(m)
```
메시 목록은 `public/physics/<robot>/files.json` (`["meshes/pelvis.STL", ...]`)에 둔다 — 워커가 fetch로 받는다. 이 json은 복사 직후 한 번 생성해서 커밋 (`ls meshes > files.json`에 해당하는 작은 node 스크립트를 `scripts/physicsFiles.mjs`로).

- [ ] Step 1: `npm i -E @mujoco/mujoco@3.15.0`. 파일 복사, `files.json` 생성.
- [ ] Step 2: 실패 테스트 `src/physics/sim.test.ts` — Node에서 `loadMujoco()` + `public/physics/g1` 파일 읽어 `loadModel` → `m.nu === 29`, `m.nq === 36`, 액추에이터 이름 순서 = `defs.g1` 관절 순서(CSV 11열부터) 확인.
- [ ] Step 3: 구현해서 통과.
- [ ] Step 4: 워커 `bench` 메시지: 로드 후 정지 자세 60 s(30000 스텝, PD만) 실행 시간을 돌려준다. 워커 생성은 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`. wasm 로딩이 Vite dev/build에서 깨지면 `optimizeDeps.exclude: ['@mujoco/mujoco']`, 필요 시 `worker: { format: 'es' }` 추가.
- [ ] Step 5: **게이트** — dev 서버(GPU 플래그, 포트 5199)에서 Playwright로 `window.__physicsBench()`(dev 전용 훅, 임시)를 호출해 측정. 기준: 로드 < 10 s, 60 s 시뮬 < 300 s(스파이크 Node 기준 ≈ 2 s). 미달이면 **중단하고 사용자에게 측정값 보고**. `vite build` 후 `dist/assets`에서 첫 화면 js에 mujoco가 없는지(별도 청크인지) 확인.
- [ ] Step 6: 임시 bench 훅 제거(워커 `bench`는 Task 4에서 `run`으로 바뀜). Commit: `feat(physics): G1 MJCF + MuJoCo loader (worker, lazy chunk)`.

### Task 2: 순수 계산 — settings / control / segments

**Files:** Add `src/physics/settings.ts`, `src/physics/control.ts`, `src/physics/segments.ts`; Test `src/physics/control.test.ts`, `segments.test.ts`, `settings.test.ts`

**Interfaces:**
```ts
// settings.ts
export interface Gains { kp: number; kd: number }
export interface RobotPhysics { groups: Record<string, Gains>; torqueScale: number; warnPct: number }
export interface PhysicsSettings { g1: RobotPhysics; go2: RobotPhysics; assist: { kpF: number; kdF: number; kpT: number; kdT: number } }
export const DEFAULT_PHYSICS: PhysicsSettings
//   g1.groups: 고관절 100/2, 무릎 150/4, 발목 40/2, 허리 200/5, 팔 40/1; go2.groups: 전체 20/0.5
//   torqueScale 1, warnPct 50; assist 2000/300/300/40
export function groupOf(robot: Robot, joint: string): string
//   g1: /hip/→고관절, /knee/→무릎, /ankle/→발목, /waist/→허리, 나머지(shoulder|elbow|wrist)→팔; go2: 전체
export function withDefaults(p?: Partial<PhysicsSettings>): PhysicsSettings   // 빠진 키를 기본값으로 채움, 값은 유한수·kp,kd ≥ 0·torqueScale > 0·warnPct 1..1000 검사(아니면 기본값)
export function cacheKey(robot: Robot, csvText: string, s: PhysicsSettings): string
//   FNV-1a 32비트 두 번(seed 다름)으로 64비트 16진 문자열. 입력 = robot + csvText + JSON.stringify(s[robot]) + JSON.stringify(s.assist)
// control.ts — 스파이크 sim.mjs의 pd()/assist() 를 순수 함수로
export function interpRow(rows: Float64Array[], tf: number): { i: number; u: number }   // i = min(floor(tf), n-2)
export function pdTorque(kp: number, kd: number, qRef: number, q: number, dqRef: number, dq: number, lim: number): { tau: number; sat: boolean }
export function rotErrLocal(qCur: [number,number,number,number], qRef: [number,number,number,number]): [number,number,number]   // wxyz, 스파이크의 conj(q)*qr 회전벡터 (w<0이면 부호 반전)
export function capNorm(v: [number,number,number], max: number): [number,number,number]
export const pctBW = (f: number, totalMass: number) => f / (totalMass * 9.81) * 100
// segments.ts
export interface Segment { from: number; to: number; maxPct: number; maxTorque: number }   // 프레임 포함 범위
export function warnSegments(pct: Float32Array, torque: Float32Array, warnPct: number): Segment[]
//   > warnPct 연속 프레임, 길이 < 3 버림 → 간격(다음 from − 이전 to − 1) ≤ 6 병합 (순서: 병합 먼저, 그다음 짧은 것 버림 — 테스트로 고정)
```

- [ ] Step 1: 실패 테스트 — `pdTorque` 클립·sat 플래그, `rotErrLocal` 항등 0·z축 90° → `[0,0,π/2]`·이중피복(−q) 같은 결과, `interpRow` 마지막 프레임 경계, `pctBW(33.34*9.81*0.5, 33.34) = 50`, `warnSegments` (2프레임 버림, 간격 6 병합·7 분리, maxPct·maxTorque), `withDefaults({})` = 기본값, 잘못된 값 → 기본값, `cacheKey` 설정·텍스트 한 글자 변경 시 달라짐·같은 입력 같음.
- [ ] Step 2: 구현, 통과. Commit: `feat(physics): pure control, segments, settings`.

### Task 3: 시뮬레이션 실행 (`sim.ts` run)

**Files:** Modify `src/physics/sim.ts`; Add `src/physics/csvRows.ts`; Test `src/physics/sim.test.ts`

**Interfaces:**
```ts
// csvRows.ts — exportItemCsv 텍스트 → 행 (헤더 1줄, 각 행 끝 쉼표 무시). 루트 = 열 4..10, 관절 = 11..
export function csvRows(text: string): Float64Array[]
// sim.ts
export interface Metrics {
  n: number                  // 프레임 수 = rows.length
  forceN: Float32Array; torqueNm: Float32Array; pct: Float32Array
  pelvisZ: Float32Array; trackErrMax: Float32Array; satJoints: Uint8Array
  meanPct: number; maxPct: number; segments: Segment[]
}
export function simulate(L: Loaded, rows: Float64Array[], s: PhysicsSettings, onProgress?: (done: number, total: number) => void): Metrics
```
규칙 (스파이크 `run()`과 같은 순서):
1. `mj_resetData` → 0프레임 자세 `setPose` → `mj_forward` → 밑창(G1: `left/right_ankle_roll_link`의 `geom_type === 2` 구, GO2: 발 구 geom) 최저점이 0이 되게 `qpos[2]` 보정, `zOff` 기억 → `mj_forward`.
2. 액추에이터 position→motor 변환 (gainprm[i*10]=1, biasprm[i*10+1..2]=0). **kp·kd는 모델 값이 아니라 `s[robot].groups[groupOf(...)]`**, 한계 `jnt_actfrcrange[2j+1] × torqueScale`.
3. 정착 0.2 s: `q_ref` = 0프레임, `dq_ref` = 0, 보조 켬(목표 = 0프레임 루트).
4. `nSteps = floor((n−1)/60/DT)`, 스텝마다 `tf = s·DT·60`, 보간 → 보조 렌치(목표 속도 기준, 상한) → PD → `mj_step`. 매 정수 프레임에서 그 프레임까지의 최대 |F|, 최대 |T|, `pelvisZ`, 관절 추종 오차 최대, 포화 관절 수 기록. 마지막 프레임 값이 비면 직전 값 복사.
5. `totalMass` = `m.body_mass` 합. `pct = pctBW(forceN, totalMass)`. `segments = warnSegments(pct, torqueNm, s[robot].warnPct)`.
6. `onProgress`는 60프레임마다.

- [ ] Step 1: 실패 테스트 (Node WASM, `public/physics/g1` 사용):
  - 정지: 기본자세 1행을 120번 반복한 행 → `meanPct < 10`.
  - 급격: 0.1 s 동안 무릎·고관절을 한계까지 흔드는 120프레임 → `segments.length ≥ 1`.
  - 결정성: 같은 입력 2회 → `pct`, `forceN` 바이트 동일.
  - 교차 확인: `assets/data/Track1_원본_합본.csv`가 있으면 앞 600행으로 실행 → `maxPct`가 20–200 범위이고 스파이크 기록(평균 31%, 최대 112%, 10 s 기준이 아닌 60 s 값이므로 범위만)과 크게 다르지 않음. 파일 없으면 `it.skip`.
- [ ] Step 2: 구현, 통과. 60 s 입력 실행 시간 출력(참고). Commit: `feat(physics): MuJoCo PD + pelvis assist simulation`.

### Task 4: 워커 · 클라이언트 · physicsStore

**Files:** Modify `src/physics/worker.ts`; Add `src/physics/client.ts`, `src/physics/physicsStore.ts`, `src/physics/runItem.ts`; Test `src/physics/physicsStore.test.ts`

**프로토콜:**
```ts
type ToWorker = { type: 'run'; id: number; robot: Robot; rows: Float64Array[]; settings: PhysicsSettings } | { type: 'cancel'; id: number }
type FromWorker = { type: 'loading' } | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; metrics: Metrics } | { type: 'error'; id: number; message: string }
```
워커: 로봇별 모델 지연 로드(fetch `files.json` → 파일들), 큐 순차, `cancel`된 id는 다음 progress 지점에서 중단(시뮬 루프가 onProgress에서 throw로 빠져나옴). 결과 Float32Array는 transfer.

**Interfaces:**
```ts
// physicsStore.ts (zustand, 저장 안 함)
export type ItemPhys = { key: string; status: 'queued' | 'running' | 'done' | 'error'; metrics?: Metrics; message?: string }
interface PhysState {
  byItem: Record<string, ItemPhys>          // itemId → 최신 요청
  progress: { done: number; total: number; label: string } | null   // 헤더 표시용 (큐 전체)
  loading: boolean
}
export const usePhysics: UseBoundStore<StoreApi<PhysState>>
export function isStale(itemId: string, currentKey: string): boolean   // 결과 key ≠ 현재 key
// runItem.ts
export function itemInput(p: Project, defs: RobotDefs, actorId: string, itemId: string): { robot: Robot; rows: Float64Array[]; key: string }
//   text = exportItemCsv(p, defs, actorId, itemId, 'local').text; key = cacheKey(robot, text, withDefaults(p.physics))
export function runItems(list: { actorId: string; itemId: string }[]): Promise<void>   // 순차 큐, 같은 item 재요청은 기존 요청 대체
export function cancelAll(): void
```
- [ ] Step 1: 실패 테스트 — 가짜 워커(메시지 주입)로: 대체 시 이전 id의 늦은 result 무시, cancel 후 status 정리, error → status 'error'·message, `isStale` 키 비교, 진행률 `2/5`.
- [ ] Step 2: 구현, 통과. Commit: `feat(physics): worker queue, client, physicsStore`.

### Task 5: `project.physics` 설정 + 물리 설정 창

**Files:** Modify `src/model/types.ts`(`Project.physics?: Partial<PhysicsSettings>`), `src/model/projectFile.ts`(저장·열기, 열 때 `withDefaults` 검사로 정규화하지 말고 원본 유지·잘못된 타입이면 무시), `src/store/store.ts`(`setPhysics(next: PhysicsSettings)` — `edit` 한 번, 실행취소 1회, dirty), `src/FileMenu.tsx`(`물리 설정…` 항목, 내보내기 위 그룹); Add `src/physics/PhysicsDialog.tsx`; Test `src/model/projectFile.test.ts`, `src/store/store.test.ts`

- `setPhysics`의 `touched`는 채널 변경이 아니므로 기존 `edit`의 touched 규칙에 맞춰 `{ clipId: null, channels: 'all' }` 등 프로젝트 전역 변경 표기를 쓴다 (store.ts의 현재 관례 확인 후 맞춤).
- 창: `<dialog>`, 로봇 탭 G1/GO2, 그룹별 kp·kd `<input type="number" min=0 step=any>`, 토크 배율, 경고 기준 %, `<details><summary>고급</summary>` 보조 PD 4개, "기본값으로", "적용"(한 번에 `setPhysics`). 문구 "참고 지표 (RL 정책 결과와 다를 수 있음)".
- stale은 별도 코드 없이 cacheKey 변화로 생긴다.

- [ ] Step 1: 실패 테스트 — physics 있는 프로젝트 저장→열기 동일, 없는 v2 파일 열기 정상, `setPhysics` 후 undo로 원복·dirty.
- [ ] Step 2: 구현, 통과. 창은 Playwright로 열어 값 변경→적용→다시 열면 유지 확인. Commit: `feat(physics): project physics settings + dialog`.

### Task 6: 타임라인 표시와 실행 메뉴

**Files:** Modify `src/timeline/SequenceCanvas.tsx`, `src/timeline/TrackCanvas.tsx`, `src/timeline/Timeline.tsx`, (트리 하위 행을 그리는 파일 — SequenceCanvas의 트랙 아코디언 행), `src/index.css`(필요한 색 토큰만)

- **실행**: SequenceCanvas 우클릭 메뉴(현재 `export하기` 옆, `SequenceCanvas.tsx:433` 부근)에 `물리 검증`(그 조각) 추가. 트랙 라벨 우클릭에 `트랙 물리 검증`(그 트랙 조각 시작 순). 로봇 모델이 없으면(GO2 미지원 상태) 메뉴 항목 disabled + 배지 `미지원`.
- **시퀀스 막대**: 결과 있으면 막대 아래 40%에 pct 그래프(0–100% 클램프, 프레임→x는 기존 timeScale), 경고 기준 점선, 세그먼트 구간 `#E5484D`. stale이면 그래프 회색. 막대 오른쪽 배지: `✓ 평균 31% · 최대 87%` / `⚠ 3` / `오래됨` / `미지원`. 빨간 구간 클릭 → `setFrame(item.start + seg.from − 해당 오프셋)` (CSV 프레임 0 = `itemFrameRange(item).from`, 기본자세 포함 여부를 `itemFrameRange`와 같은 기준으로).
- **트리 하위 행**: 이름 뒤 `· 최대 87% ⚠3`.
- **클립 보기**(TrackCanvas): 시간축 위 24 px `보조력` 띠(같은 그래프, 클립 프레임 기준). 해당 조각 결과가 없으면 띠 숨김.
- **헤더**(Timeline.tsx `TimelineHeader`): `progress` 있으면 `물리 검증 2/5 · 42%` + `[취소]` 버튼(`cancelAll`), `loading`이면 `물리 엔진 불러오는 중…`.

- [ ] Step 1: 그래프 x 좌표·세그먼트 클릭→프레임 변환을 순수 함수(`physGraph.ts`)로 빼고 단위 테스트.
- [ ] Step 2: 구현. Playwright(5199, GPU 플래그)로 가져오기→우클릭 물리 검증→그래프·배지 스크린샷, 키 편집→`오래됨`. Commit: `feat(physics): timeline assist graph, badges, run menu`.

### Task 7: 내보내기 통합

**Files:** Modify `src/export/validate.ts`(`Warning.kind`에 `'physicsAssist'` 추가), `src/export/ExportDialog.tsx`, `src/export/exportOne.ts`; Test `src/export/exportOne.test.ts`(있으면 수정, 없으면 추가)

- ExportDialog: 체크된 항목 중 결과 없음·stale인 것을 열 때 자동 `runItems`(진행률 표시), "물리 검증 건너뛰기" 체크박스(켜면 실행·경고 생략, 대화상자 상태만·저장 안 함). 결과의 세그먼트를 `{ kind: 'physicsAssist', frame: seg.from, channel: 'root', message: '물리 보조력 · f1070–1094 · 최대 99% 체중' }`로 경고 목록에 붙인다. 검증 중에는 내보내기 버튼 disabled(`물리 검증 중…`). 경고 클릭 이동은 기존 경로 그대로.
- exportOne: `ask` 전에 그 조각이 없음/stale이면 `await runItems([...])` 후 세그먼트 수를 경고 수에 합산. 메시지 `경고 N개가 있습니다 (관절 한계·속도·루트·물리 보조력)`. 엔진 로드 실패·미지원이면 물리 경고 없이 진행하고 메시지 끝에 ` (물리 검증 생략: 미지원)`.
- 내보내는 CSV 텍스트는 바뀌지 않는다 (테스트로 고정).

- [ ] Step 1: 실패 테스트 — 가짜 runItems로 세그먼트 2개 → exportOne의 `ask` 메시지 숫자 증가, 건너뛰기 → 기존 숫자, CSV 텍스트 동일.
- [ ] Step 2: 구현, 통과. Commit: `feat(physics): physics assist warnings in export`.

### Task 8: GO2 모델

**Files:** Add `public/physics/go2/scene.xml`, `meshes/`, `files.json`; Modify `src/physics/sim.ts`(GO2 몸통 body 이름·발 geom 선택), `sim.test.ts`

- 원본: `unitree_mujoco` 저장소 `unitree_robots/go2/` (`go2.xml`, `scene.xml`, `assets/`). 바닥 plane 포함, timestep은 코드가 0.002로 덮어씀. 액추에이터 순서가 `defs.go2` 관절 순서(CSV 11열부터)와 같은지 이름으로 검사하고, 다르면 sim.ts에서 이름→열 매핑 배열을 만든다(G1도 같은 경로로 통일해도 됨).
- 몸통 body는 freejoint를 가진 body(`m.jnt_type === 0`인 joint의 `jnt_bodyid`)로 찾는다 — 이름 하드코딩 안 함(G1 pelvis도 같은 규칙).
- 액추에이터가 position이 아니라 motor면 변환 생략(gainprm 검사).
- 정지 테스트(< 10%)·결정성 테스트를 GO2에도.
- [ ] 맞추지 못하면 GO2는 `미지원`으로 두고(`files.json` 없음 = 미지원) 사용자에게 보고. Commit: `feat(physics): GO2 model`.

### Task 9: e2e

**Files:** Add `e2e/physics.spec.ts`

- 가져오기(G1 CSV) → 클립 막대 우클릭 `물리 검증` → 배지 `✓` 표시(타임아웃 60 s) → 키 하나 편집 → `오래됨` → 파일 ▸ 물리 설정… 경고 기준 10% 적용 → `오래됨` → 내보내기 창 열기 → 자동 재검증 후 경고 목록에 `물리 보조력` 항목.
- [ ] 전체 vitest·tsc·build·e2e 통과. `CLAUDE.md`의 진행 상황·다음 작업 갱신. Commit: `test(e2e): physics assist flow`.
