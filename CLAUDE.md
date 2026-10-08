# CLAUDE.md

Unitree G1(휴머노이드 29 DoF)·GO2(사족 12 DoF) 모션을 키프레임·타임라인으로 편집하고, **강화학습(모션 모방)용 CSV**로 내보내는 웹 편집기. 프리미어 프로식 레이아웃(시퀀스·클립·크로스페이드·참조 영상).

## 작업 규칙

- **사용자 응답은 한국어.** 코드·식별자·에러 문구는 그대로.
- UI 문구는 한국어, 버튼은 동작 이름("저장", "CSV 가져오기"), 결과 문구는 같은 동사("저장했습니다").
- 새 기능은 superpowers 흐름: 설계 합의 → `docs/superpowers/specs/` 스펙 → `docs/superpowers/plans/` 계획 → 서브에이전트 구현·리뷰 → 브랜치에서 작업 후 `master` 머지. 작은 수정은 짧은 설계 확인 후 바로.
- 브랜치를 만들고 작업한다. 머지·푸시는 사용자가 요청할 때.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## 명령

```bash
npm i
npm run dev        # http://localhost:5173
npm run test       # vitest (단위)
npx tsc -b         # 타입 검사
npm run build
npm run e2e        # Playwright (dev 서버 자동 기동, 포트 5173)
```

- 브라우저 수동 확인용 Playwright 스크립트는 **저장소 밖**에 두고 `npx vite --port 5199`로 띄운 뒤 반드시 종료.
- headless Chromium은 기본이 소프트웨어 WebGL이라 느림 → `--enable-gpu --ignore-gpu-blocklist --use-angle=d3d11`.
- 개발 모드 훅: `window.__editor`(zustand StoreApi), `window.__stage`/`__stages`, `window.__tv`.

## 기술 스택과 제약

- Vite + React 19 + TypeScript + three.js + zustand. 런타임 의존성은 이 넷뿐(물리 검증 구현 시 `@mujoco/mujoco` 추가 예정 — 스펙 참고).
- **파일 API는 `src/fileio.ts`에만**(Tauri/Electron 래핑 시 교체 지점).
- 60 fps 고정, 정수 프레임.
- 색 토큰: `--bg #22262D`, `--panel #2B3038`, `--line #3B424D`, `--text #D5DAE1`, `--accent #F0A43A`, G1 `#58B4D1`, GO2 `#C9D65A`. 서체 IBM Plex Sans KR, 수치 `tabular-nums`. 대문자 라벨·그림자·그라데이션 금지.

## CSV 형식 (가져오기·내보내기 공통 — RL 학습 입력)

- 1행 헤더: `frequency(fps),RobotType,DOF Number,time(ms),position X(m),position Y(m),position Z(m),quaternion X,quaternion Y,quaternion Z,quaternion W,<URDF 관절 이름>,` (끝 쉼표)
- 행: `60,<0=G1|1=GO2>,<29|12>,round(i*1000/60),x,y,z,qx,qy,qz,qw,q…,` (모든 줄 끝 쉼표, 마지막 줄 줄바꿈 없음, 소수 6자리). G1 41열, GO2 24열.
- 관절 열 순서 = `RobotDef.joints` = URDF revolute 순서 (GO2: FL, FR, RL, RR — 사용자 확정).
- 가져오기는 헤더 이름으로 열 매칭, DOF로 로봇 판별, fps 30이면 60으로 리샘플. 헤더 없는 36/19열 구형식도 지원.
- 내보내기 루트: 로컬(첫 프레임 x·y·yaw = 0, 기본) / 월드.
- 샘플: `assets/data/Track1_원본_합본.csv`(12,638행, G1). `assets/video/Track1.mov`(참조 영상, 395 MB)는 **git 미포함** — 원본 PC에서 따로 옮길 것.

## 구조

```
src/robot/     RobotDef 로드(public/robots/<g1|go2>/model.json, meshes.json)
src/model/     types, curve(베지어/선형/홀드), pose(evaluateClip), sequence(여러 Item·크로스페이드·루트 이어붙이기),
               evaluate(시퀀스→월드 포즈), projectFile(v2 압축 저장·v1 읽기), restPose, simplify, video, defaults
src/store/     zustand 스토어(edit(fn, touched) 채널 단위 구조 공유·dev freeze, tryEdit, 제스처 실행취소, 잠금 규칙)
src/export/    csv(samplePoses·posesToCsv·exportItemCsv·withRestPose), validate, importCsv, ExportDialog, exportOne
src/timeline/  SequenceCanvas(시퀀스·트리·V1), TrackCanvas·GraphCanvas(클립 보기), ruler, follow(재생헤드 따라가기), assetDrop
src/viewer/    Stage(패널별 three.js 인스턴스), StagePanes(영상/로봇/클립·비교 프리뷰 도킹), VideoOverlay, follow(카메라)
src/project/   ProjectPanel(에셋 카드·⇄비교·우클릭), CsvFpsDialog
src/media/     영상 URL 레지스트리(프로젝트에 저장 안 함 → 열면 오프라인, 재연결)
src/layout/    패널 크기 조절
tools/urdf_to_json.py   URDF+DAE → RobotDef JSON (GO2 생성에 사용)
```

핵심 불변식:
- **미리보기 = CSV**: 뷰어와 내보내기 모두 `evaluate`/`exportItemCsv`만 사용.
- 클립은 공유 데이터(잘린 조각·재배치가 같은 클립 참조). "기본자세 세팅"은 클립을 바꾸지 않고 Item의 `restPose` 표시 → 클립 프리뷰와 그 조각 CSV에만 반영, 타임라인 재생은 원본.
- 3D 패널 언마운트 시 `renderer.forceContextLoss()` 필수(WebGL 컨텍스트 누수로 메인 프리뷰가 꺼졌던 버그, `e2e/webgl.spec.ts`).
- 에셋 드롭은 겹침을 만들지 않음(겹치면 뒤에 붙임). 크로스페이드는 타임라인에서 직접 겹칠 때만.
- 트랙의 마지막 클립을 지우면 그 액터·트랙도 삭제(클립은 에셋에 남음).

## 진행 상황

완료(모두 `master`): M1 코어, M2 시퀀스, M3 참조 영상, 개선 1(파일 v2·키 줄이기·잠금·패널 크기), 이후 UI 개선(파일 메뉴·에셋 카드·⇄비교 프리뷰·트리·클립 프리뷰·기본자세 표시·호버 스크럽·재생헤드/카메라 따라가기·단일 export하기).

**다음 작업 — MuJoCo 물리 검증(골반 보조력 지표)**
- 스펙 승인됨: `docs/superpowers/specs/2026-10-08-physics-assist-design.md`. 다음 단계는 **구현 계획 작성**(writing-plans). 첫 작업은 브라우저 웹 워커 실측(1분 모션 ≤ 5분, 미달 시 중단·보고).
- 스파이크 결과(Node, `@mujoco/mujoco` 3.15.0): G1 60 s ≈ 2 s, 결정적, 보조 없음 f66 넘어짐, 보조 있음 Track1 60 s 평균 31%·최대 112% 체중.
- G1 MJCF·메시 원본은 원래 PC의 `D:/Project/00_ROS/G1_motion_editor_인수인계_20261002/02_g1/g1-motion-editor/mujoco/`(g1_scene.xml, meshes/, replay.py). 다른 PC라면 이 폴더를 받아 `public/physics/g1/`로 복사해야 함. GO2 MJCF는 unitree_mujoco 레포에서.
- RL팀 kp/kd 값은 아직 없음 → Unitree 공개값 기본, 설정 창에서 수정 가능하게.

## 알려진 남은 항목

- 크로스페이드 이음새 뷰어상 1프레임 루트 멈춤(CSV 영향 없음), 드래그 중 Ctrl+Z 시 실행취소 세분화, 잘린 조각들의 CSV 파일 이름이 같음(`G1_<클립>.csv`).
- 기본자세는 조각 앞 1.5 s를 **덮어씀**(길이 유지). "앞에 덧붙이기(+90프레임)" 방식은 제안만 됨.
- GO2 RobotType 코드 1은 추정값(GO2 샘플 CSV로 확인 필요).
