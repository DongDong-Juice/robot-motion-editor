# MuJoCo 물리 검증 (골반 보조력 지표) 설계

- 날짜: 2026-10-08
- 상태: 승인됨 (구현 계획 작성 전)
- 근거: 스파이크 `scratchpad/mujoco-spike` (Node, `@mujoco/mujoco` 3.15.0) — G1 60 s를 약 2 s, 결정적, 보조 없음은 f66 넘어짐(기존 `replay.py`와 동일), 보조 있음은 체중% 지표가 Python 기록과 같은 구간.

## 1. 목적

편집한 모션을 실제 로봇 제어식(관절 PD 500 Hz, 토크 한계)으로 시뮬레이션해서, **"단순 PD로 재현하려면 골반을 얼마나 붙잡아 줘야 하는가"(체중 대비 보조력 %)**를 프레임마다 보여 준다.

- 쓰임 1: 타임라인에 보조력 그래프·경고 구간 → 무리한 구간 찾아 편집.
- 쓰임 2: 내보내기 전 검사 — 경고 구간을 기존 경고 목록에 추가.
- 대상: G1, GO2.
- 비목표: RL 정책 결과와 동일한 물리, 물리 결과 로봇을 따로 재생하는 프리뷰(다음 단계).

## 2. 실행과 결과 보관

- **수동 실행**: 클립 막대·트리 하위 행 우클릭 "물리 검증", 트랙 라벨 우클릭 "트랙 물리 검증"(조각 순차).
- 입력 = 그 조각의 `exportItemCsv`와 **같은 프레임**(기본자세 표시·루트 로컬 반영) → 화면 결과와 내보내기 검사 결과가 같다.
- 결과는 메모리(`physicsStore`, 저장 안 함). 캐시 키 = 클립 데이터·조각 범위·기본자세 표시·루트 모드·물리 설정의 해시. 키가 바뀌면 `stale`.
- 내보내기(대화상자·단일 export하기)는 결과가 없거나 stale인 조각을 **자동 재검증**(진행률 표시). "물리 검증 건너뛰기" 체크박스 제공.

## 3. 구조

```
UI (메인)                                Physics Worker (src/physics/worker.ts)
physicsStore ── run{id,robot,fps,rows,settings} ──▶ init(lazy): import @mujoco/mujoco,
  results/queue/progress                              fetch /physics/<robot>/scene.xml+메시,
            ◀── progress{id,done,total} ─────────     FS.writeFile → MjModel.from_xml_path,
            ◀── result{id,metrics(Float32Array)} ─    position→motor 변환
            ◀── error{id,message} ───────────────     정착 0.2 s → 500 Hz 루프
```

- 워커 하나, 큐 순차 처리, 같은 조각 재요청은 기존 작업 대체, 취소 지원.
- 진행률: 타임라인 헤더 `물리 검증 2/5 · 42% [취소]`. 최초 1회 "물리 엔진 불러오는 중…".
- wasm은 지연 로딩 청크(첫 화면 번들 제외).

### 출력 metrics (60 fps 프레임마다)

보조력 |F|(N), 보조 토크 |T|(Nm), 체중% = |F| / (모델 총질량·9.81), 골반 높이, 관절 추종 오차 최대(rad), 토크 포화 관절 수.
요약: 평균·최대 %, 경고 구간 `[from, to, max%, maxTorque]`.

### 물리 설정 `project.physics` (저장됨, 없으면 기본값)

```ts
physics: {
  g1:  { groups: { 다리: {kp, kd}, 발목: {kp, kd}, 허리: {kp, kd}, 팔: {kp, kd} }, torqueScale: 1, warnPct: 50 },
  go2: { groups: { 전체: { kp: 20, kd: 0.5 } }, torqueScale: 1, warnPct: 50 },
  assist: { kpF: 2000, kdF: 300, kpT: 300, kdT: 40 },
}
```
G1 기본(Unitree 공개값): 다리 hip 100/2·knee 150/4, 발목 40/2, 허리 200/5, 팔 40/1.

### 모델 파일

- `public/physics/g1/`: 기존 프로젝트 `mujoco/g1_scene.xml` + `meshes/`(19 MB) 복사.
- `public/physics/go2/`: unitree_mujoco `go2` MJCF, 바닥·timestep을 G1과 같은 규칙으로 정리. 맞추지 못하면 GO2 "미지원"으로 두고 G1 먼저.

## 4. 시뮬레이션 규칙

- timestep 0.002 s(500 Hz). q_ref는 60 fps 프레임 사이 선형 보간(소수 시간 그대로), dq_ref는 차분. metrics는 60 fps 프레임마다.
- 시작: 0프레임 자세 + 밑창이 바닥에 닿도록 루트 높이 보정 → 보조 켠 채 0.2 s 정착.
- 관절: position 액추에이터 → motor. `τ = kp·(q_ref − q) + kd·(dq_ref − dq)`, `±effort × torqueScale`로 클립(포화 기록). effort = URDF.
- 보조: 골반(GO2는 몸통) `xfrc_applied`.
  `F = kpF·(p_ref − p) + kdF·(v_ref − v)`, `T = kpT·자세오차 + kdT·(ω_ref − ω)`. (기존 Python의 `−kd·v`를 목표 속도 기준으로 바꿈 — 원래 움직이는 모션에 쓸데없는 보조가 잡히지 않게.)
- 쿼터니언: CSV xyzw → MuJoCo wxyz. freejoint 각속도는 로컬 좌표.
- 경고 구간: `warnPct` 초과 연속 프레임, 3프레임 미만 무시, 6프레임 이내 간격은 병합.
- 결정성: 같은 입력·설정 → 비트 단위로 같은 결과. 난수·현재 시각·비동기 순서 의존 금지.
- 표시 문구에 "참고 지표 (RL 정책 결과와 다를 수 있음)" 명시.

## 5. UI

- **시퀀스 보기**: 결과 있는 조각 막대 아래 40%에 보조력 % 그래프(0–100%), 경고 기준 점선, 초과 구간 `#E5484D`. 막대 오른쪽 배지: ✓ 평균/최대%, ⚠ 구간 수, 오래됨(회색), 미지원. 트리 하위 행 `· 최대 87% ⚠3`. 빨간 구간 클릭 → 재생헤드 이동.
- **클립 보기**: 시간축 위 24 px "보조력" 띠.
- **물리 설정 창**(파일 ▸ 물리 설정…, `<dialog>`): 로봇 탭(G1/GO2), 그룹별 kp·kd, 토크 배율, 경고 기준 %, "고급"에 보조 PD 4개, "기본값으로". 변경 = 실행취소 1회·dirty·모든 결과 stale.
- **내보내기 경고**: `물리 보조력 · f1070–1094 · 최대 99% 체중`, 클릭 시 이동, 기존 "경고 N개 무시하고 내보내기".

## 6. 파일 구조

```
src/physics/settings.ts      기본값·그룹 매핑·병합, 캐시 키 해시
src/physics/control.ts       순수: 보간, PD+클립, 보조 렌치, 체중%
src/physics/segments.ts      순수: 경고 구간 묶기
src/physics/sim.ts           MuJoCo 래퍼(워커·Node 공용)
src/physics/worker.ts        프로토콜·큐·진행률
src/physics/client.ts        메인 쪽 워커 관리·run/cancel
src/physics/physicsStore.ts  결과·상태(저장 안 함)
src/physics/PhysicsDialog.tsx
(수정) SequenceCanvas, TrackCanvas, ExportDialog, exportOne, projectFile, types, App
```

- 의존성: `@mujoco/mujoco@3.15.0` 추가(런타임 의존성 제한의 첫 예외, 공식 패키지).

## 7. 테스트

- 단위: control(보간·PD·클립·체중%), segments(묶기·병합), settings(병합·키 변화).
- 시뮬(vitest, Node WASM): 정지 2 s 평균 보조 < 10%, 급격한 관절 모션 → 경고 구간 ≥ 1, 결정성(비트 동일), 원본 CSV가 있으면 Track1 10 s 결과가 기존 기록 프레임대와 일치(없으면 건너뜀).
- e2e: 가져오기 → 우클릭 물리 검증 → 그래프·배지 / 편집 → stale / 내보내기 경고 목록 / 설정 변경 → stale.

## 8. 위험

| 위험 | 대응 |
|---|---|
| 브라우저 실측 없음 | 첫 작업에서 워커 실측, 1분→5분 기준 미달 시 중단·보고 |
| 메시 19 MB 로딩 | `FS.writeFile`(20 ms), 첫 로딩 2–4 s |
| GO2 MJCF 미확보 | unitree_mujoco에서 정리, 실패 시 G1 먼저 |
| RL 결과와 차이 | 설정에 RL팀 값 입력, "참고 지표" 명시 |
| 긴 트랙 | 큐·진행률·취소, 조각별 캐시 |
