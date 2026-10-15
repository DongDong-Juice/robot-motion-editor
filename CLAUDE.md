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

- Vite + React 19 + TypeScript + three.js + zustand. 런타임 의존성은 이 넷 + `@mujoco/mujoco@3.15.0`(물리 검증, 웹 워커).
- **파일 API는 `src/fileio.ts`에만**(Tauri/Electron 래핑 시 교체 지점).
- 60 fps 고정, 정수 프레임.
- 색 토큰: `--bg #22262D`, `--panel #2B3038`, `--line #3B424D`, `--text #D5DAE1`, `--accent #F0A43A`, G1 `#58B4D1`, GO2 `#C9D65A`, 기본자세 조각 `--rest #A98BE0`, 전이 `--blend #7D9BEA`, 관성 구간 `--inertia #E58FB0`. 서체 IBM Plex Sans KR, 수치 `tabular-nums`. 대문자 라벨·그림자·그라데이션 금지.

## CSV 형식 (가져오기·내보내기 공통 — RL 학습 입력)

- 1행 헤더: `frequency(fps),RobotType,DOF Number,time(ms),position X(m),position Y(m),position Z(m),quaternion X,quaternion Y,quaternion Z,quaternion W,<URDF 관절 이름>,` (끝 쉼표)
- 행: `60,<0=G1|1=GO2>,<29|12>,round(i*1000/60),x,y,z,qx,qy,qz,qw,q…,` (모든 줄 끝 쉼표, 마지막 줄 줄바꿈 없음, 소수 6자리). G1 41열, GO2 24열.
- 관절 열 순서 = `RobotDef.joints` = URDF revolute 순서 (GO2: FL, FR, RL, RR — 사용자 확정).
- 가져오기 경로: 메뉴 ▸ CSV 가져오기, 또는 목록 패널에 CSV 파일을 끌어다 놓기(`importDroppedFiles`, 같은 처리·CSV 아닌 파일은 건너뛰고 목록에 표시).
- 가져오기는 헤더 이름으로 열 매칭, DOF로 로봇 판별, fps 30이면 60으로 리샘플. 헤더 없는 36/19열 구형식도 지원.
- 내보내기 루트: 로컬(첫 프레임 x·y·yaw = 0, 기본) / 월드.
- 파일 이름: `<G1|GO2, 같은 로봇 액터가 여럿이면 액터 이름>_<클립>.csv`. 한 클립을 여러 조각이 쓰면 시작 순으로 `_1`, `_2`…
- 테스트 예제: `assets/examples/`(합성 G1·GO2 CSV 형식별·경고·오류 파일 + 예제 프로젝트, README 참고). `node tools/make_examples.mjs`로 다시 생성.
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
- 클립은 공유 데이터(잘린 조각·재배치가 같은 클립 참조). 기본자세(차렷 = `RobotDef.rest`, 로봇별 관절각·바닥 높이, `loadRobot.ts` `REST`)는 클립을 바꾸지 않고 Item의 `restPose` 표시(`true` 덮어쓰기: 앞 1.5 s를 바꿈·길이 유지 / `'prepend'` 덧붙이기: 앞에 리드인 = 차렷 정지(`restHold`, 기본 30) → 전이(`restBlend`, 기본 60, `'auto'` = 관절 속도 한계 50%로 최소 길이) → 관성(`inertia`, 자른 위치 앞 원본 프레임, 없으면 자동 판정 `model/inertia.ts`: 1.5 s 안에서 조용한 지점·움직임 바닥까지 거슬러 올라감, 못 찾으면 '검토 필요'; 조각 수정 층이 있으면 `itemClip` 기준). 길이는 `leadOf`/`itemLead`/`restLead(p, defs, item)`로만 구함, 조각마다 클립 프리뷰의 리드인 설정 줄에서 바꿈. 전이 끝 속도 = 관성 시작 속도, 루트 x·y·yaw는 정지·전이 동안 관성 시작 값에 고정(사용자 확정: 드리프트 없음), 다리는 전이 동안 IK로 다시 풀어 발이 바닥에서 미끄러지지 않음(사용자 확정: "드리프트 하면 안된다"): 발마다 그대로 딛고 있거나, 들어서 모션 첫 프레임 자리에 내려놓음, 한 발씩 차례로(`model/legIk.ts` `stepPlan`·`solveLeg`, G1 발 위치+기울기, GO2 발 끝 위치). 관성 자동은 두 발이 딛고 선 프레임에서만 시작(`footContact`, 없으면 '발이 떠 있음' 경고), 전이가 걸음에 비해 짧으면 '걸음이 빠름' 경고. 회귀 검사 `src/model/leadIn.sweep.test.ts`(Track1 샘플을 여러 위치에서 잘라 발 미끄러짐·공중 정지·순간이동·관절 속도 확인) — 리드인 코드를 바꾸면 반드시 통과시킬 것, CSV +리드인 행, 물리 그래프는 `seqFrameOf`로 오프셋. 스펙 `docs/superpowers/specs/2026-10-14-inertia-lead-in-design.md`) → **클립 프리뷰와 그 조각 CSV에만** 반영, 메인 타임라인 재생은 원본(사용자 확정: 메인 트랙에선 기본자세 안 함). 자르기(C, 또는 시퀀스 상단 `자르기` 버튼 = 입력한 시퀀스 프레임에서 같은 대상 규칙 `cutAtFrame`)는 앞쪽 기본자세(덮어쓰기·덧붙이기)를 켜지 않음(사용자 확정: 클립 프리뷰 버튼으로만 설정). 대신 **끝 기본자세**(`Item.restTail`)를 켬: 왼쪽 조각 `??= true`(사용자가 끈 `false`는 유지), 오른쪽 조각 `true`(사용자 확정: 자를 때마다 각 조각 끝에 기본자세). 끝 기본자세 = 마지막 프레임 뒤 전이(자동) → 차렷 정지 0.5 s, 조각 끝을 뒤집어 덧붙이기 리드인을 만들고 다시 뒤집음(`appendRestPose`·`tailOf`·`itemTail`·`tailedClip`, 드리프트·발 미끄러짐 없음). 클립 프리뷰와 조각 CSV에만(CSV 끝 행 `restTailRows`), 레인은 막대 뒤 `전이`·`기본자세` 블록, 클립 프리뷰 `끝 기본자세` 버튼으로 켜고 끔(`setRestTail`). 회귀 검사 `src/model/restTail.sweep.test.ts`. 스펙 `docs/superpowers/specs/2026-10-14-cut-rest-tail-design.md`. 타임라인 표시: 트랙을 펼치면(▾, 조각이 늘어 2개 이상이 되면 자동) 조각마다 아래로 한 줄씩 계단식 레인에 실제 막대가 놓이고(이동·트림·우클릭·물리 그래프 모두 레인에서), 트랙 줄은 이름만. 기본자세 구간만 `--rest` 색: 덮어쓰기 = 조각 앞 1.5 s, 덧붙이기 = 조각 시작 바로 앞 리드인(기본자세(정지) `--rest`·전이 `--blend`·관성 `--inertia` 세 색 블록, 각각 "기본자세"·"전이"·"관성" 라벨, 검토 필요면 레인 라벨 앞 ⚠; 한 줄로 접으면 얇은 띠). 클립 프리뷰는 자체 시계가 아니라 메인 재생헤드를 따름(조각 start = 프리뷰 첫 프레임, 덧붙이기면 리드인 시작 = 조각 start − 리드인 길이가 첫 프레임 → 프리뷰·레인·물리 그래프·CSV 행이 같은 시각에 맞음). 스펙 `docs/superpowers/specs/2026-10-12-restpose-prepend-design.md`.
- 3D 패널 언마운트 시 `renderer.forceContextLoss()` 필수(WebGL 컨텍스트 누수로 메인 프리뷰가 꺼졌던 버그, `e2e/webgl.spec.ts`).
- 에셋 드롭은 겹침을 만들지 않음(겹치면 뒤에 붙임). 크로스페이드는 타임라인에서 직접 겹칠 때만.
- 트랙의 마지막 클립을 지우면 그 액터·트랙도 삭제(클립은 에셋에 남음).
- 조각 숨기기(`Item.hidden`, 레인의 눈 아이콘): 트랙 숨기기처럼 화면 전용. 재생헤드가 그 조각 안이면(크로스페이드는 둘 다 숨김일 때) 메인 3D에서 로봇을 그리지 않음(`sequence.hiddenAt`). 평가·CSV·물리는 그대로, 프로젝트에 저장.
- 잘린 조각 이름(`pieceTag`/`pieceName`, model/sequence): 같은 클립을 쓰는 조각이 트랙에 2개 이상이면 `#n · F<trimIn>–<trimOut> · 클립 이름` (n = 시작 순, CSV 파일 `_n`과 같음). 막대·레인 라벨·클립 프리뷰 제목에 표시, 클립 이름 자체는 그대로.
- 클립 프리뷰가 어느 조각인지(사용자: 오른쪽 패널과 매칭이 안 됨): 제목 = 액터 색 견본 + 액터 이름 / 조각 이름, 제목을 누르면 그 조각·로봇을 선택(오른쪽 패널이 따라감). 프리뷰 로봇은 그 액터 색. 타임라인에서 프리뷰 중인 조각은 막대 안쪽 점선 테두리 + 레인 라벨 앞 ▶.
- 경로 표시(`Track.trail`, 모션 트랙 이름 줄의 경로 아이콘, 기본 꺼짐): 로봇마다 따로 켬(사용자 확정: 전체 한꺼번에 X). 메인 3D에 그 액터의 골반 바닥 경로, 트랙을 숨기면 같이 숨김, 화면 전용·프로젝트에 저장. 클립·비교 프리뷰 창의 `경로 표시` 버튼은 그 창 로봇 하나용.
- 조각 수정 층(`Item.offset`, 클립 프레임 기준 차이값 곡선): 인스펙터 기본값 `이 조각 수정`(스토어 `layer: 'piece'`)이면 슬라이더·기즈모·키 편집이 클립이 아니라 그 조각의 수정 층에 들어감(자동 키 불필요). 재생·프리뷰·CSV는 `itemClip`(원본 + 수정, 관절 한계로 자름)으로 평가. `원본 클립 수정`은 예전처럼 클립을 고침(자동 키 필요). 키 액션은 클립 ID 또는 조각 ID(`keyOwner`)를 받음. 값 편집(`setValue`: 슬라이더·숫자·기즈모)은 그 프레임 근처만 바꿈(사용자: 한 프레임 고쳤더니 계속 다리를 들고 있음): 양쪽 `OFFSET_EASE`(15프레임) 안에 키가 없으면 그 자리에 편집 전 수정 층 값 키를 넣어 원래 동작으로 돌아감(`offsetPins`). `키 추가`·`setKey`는 그대로. 수정본 창에도 기본자세 덮어쓰기·끝 기본자세·리드인 설정(설정은 조각 하나에 공통, 각 창은 자기 쪽으로 재생). 스펙 `docs/superpowers/specs/2026-10-13-piece-offset-design.md`.
- 원본 · 수정본 분리(`Item.use?: 'original'`, 없으면 수정본, 프로젝트에 저장): `itemClip` = 쓰는 쪽(재생·CSV·물리·리드인·클립 프리뷰), `editedClip` = 항상 원본 + 수정 층(인스펙터·그래프·기즈모·수정본 창). 시퀀스: 수정 키가 있는 조각 레인 아래 `수정` 줄(트랙 자동 펼침), 쓰는 쪽 줄 라벨 앞 `●`(누르면 그 줄로 바꿈, `setItemUse`), 안 쓰는 쪽 반투명, 수정 줄 클릭 = 수정 비교, 우클릭 수정본 사용·원본 사용·수정 비교·수정 지우기. 수정 비교(`previewEdit`, `openEditCompare`): 클립 프리뷰 자리에 `수정본` 창, 메인은 그 조각을 원본으로 그림(`withUse`, 제목 `· 원본 (조각)`, 그 조각 메인 기즈모 잠금 `'compare'`), `겹쳐 보기` = 메인에 수정본 고스트. `이 조각 수정`으로 첫 수정 키가 생기면 자동으로 열림(다른 조각 프리뷰 중이면 그대로). 원본 조각과 수정본은 따로 지움(사용자 확정): 수정 줄을 고르고(`selectItem(id, true)` → `selEdit`) Delete = 수정본만(조각은 원본으로), 조각 레인 Delete = 원본만 지우고 수정본은 그 자리에 남음(`Item.noOriginal`, 레인 자체가 수정본·원본 사용/수정 비교 없음, 그 상태에서 다시 지우면 조각 삭제) — `removePiece(id, part)`. 수정 줄 이름 = 조각 이름 + 수정본(`#2 · F150–300 수정본`, 다시 자르면 수정본도 같이 잘리고 이름이 따라감). `수정 완료`(수정 줄 우클릭·수정본 창) = `bakeEdit`: 수정본을 새 클립 `<클립> #n 수정본`으로 목록에 넣고 조각이 그 클립을 씀(원본 클립·다른 조각 그대로). 스펙 `docs/superpowers/specs/2026-10-14-edit-compare-design.md`.
- 시퀀스 휠: 그냥 휠은 트랙 줄 세로 스크롤만(줄이 넘칠 때만 움직임, 사용자 확정: 시퀀스 시간은 휠로 안 움직임). 시간 이동은 Shift+휠·트랙패드 좌우·아래 가로 스크롤바, Ctrl+휠은 확대/축소.
- Space = 항상 시퀀스 재생/정지(`transport.ts` 캡처 단계 `onSpace`, 포커스된 버튼·메뉴보다 먼저). 텍스트 입력·폼 컨트롤만 예외.
- 클립 편집 모드(스펙 `docs/superpowers/specs/2026-10-15-clip-edit-mode-design.md`): 목록 카드 더블클릭(또는 우클릭 `클립 편집`) = 그 클립만 가상 액터·조각(`CLIP_ACTOR`·`CLIP_ITEM`, 프로젝트에 안 들어감, `actorOf`·`targetItem`으로 찾음)에 올려 원점에서 편집, `시퀀스로`/Esc = 나가며 재생헤드·편집 대상 복원. 편집은 클립 수정 층 `Clip.offset`(차이값 곡선, 소유자 `asset:<clipId>`, layer `'asset'` = `이 클립 수정`, 자동 키 없이 씀)에, `원본 클립 수정`은 자동 키 필요. `baseClip` = 원본 + 클립 수정 층 → 모든 조각·CSV·물리가 이것 위에 조각 수정 층(`Item.offset`). `원본 보기`(누르는 동안)·`겹쳐 보기`·`CSV 저장`(`exportClipCsv`, 로컬 루트, 리드인 없음). 루트 기즈모는 잠금(패널 숫자로). 수정된 카드에 `●`. 키 줄이기는 원본 곡선만, 길이를 줄이면 수정 층 키도 자름.
- 관절 패널(`viewer/JointPanel.tsx`) = 인스펙터의 `값` 섹션(편집 대상 바로 아래, 사용자: 3D 위에 뜨면 로봇이 가려짐): 고른 관절의 부위 전체 줄(이름·숫자 / 슬라이더 두 줄), `◀ 1F`·`1F ▶` 프레임, `◀ 키`·`키 ▶` 고른 관절의 키, 키 추가·삭제·보간, 도/rad(`degrees`), ↑↓ 관절·←→ 값(Shift ×10), 클립 보기면 구간 줄.
- 구간 수정(`range`, 클립 보기·클립 편집에서만, 저장 안 함): 눈금자 Shift+드래그로 고름, 값 바꾸면 같은 차이를 [a, b]에 더하고 가감 프레임만큼 양쪽을 부드럽게(`model/rangeEdit.ts`), 재생헤드가 구간 밖이면 막음. 제스처 중 시퀀스 레인은 리드인·끝 기본자세 길이를 제스처 시작 값으로 그림.
- 타임라인 캔버스는 글꼴(IBM Plex) 로드가 끝나면 다시 그림(`document.fonts` `loadingdone`).
- 드래그 중 Ctrl+Z = 그 드래그만 취소(드래그 전 상태, 다시 실행 없음). 캔버스 드래그는 `timeline/drag.ts`의 `trackDrag(mv, up, cancel)`, 슬라이더·기즈모 제스처는 스토어 `undo`가 `cancelGesture` 후 그 제스처의 나머지 편집을 무시.

## 진행 상황

완료(모두 `master`): M1 코어, M2 시퀀스, M3 참조 영상, 개선 1(파일 v2·키 줄이기·잠금·패널 크기), 이후 UI 개선(파일 메뉴·에셋 카드·⇄비교 프리뷰·트리·클립 프리뷰·기본자세 표시·호버 스크럽·재생헤드/카메라 따라가기·단일 export하기).

물리 검증(골반 보조력 지표): 구현·e2e 완료, `master` 머지.

## 물리 검증 (MuJoCo 골반 보조력)

- 스펙 `docs/superpowers/specs/2026-10-08-physics-assist-design.md`. 코드 `src/physics/*`(worker·sim·control·segments·runItem 큐/오래됨 판정·physicsStore·PhysicsDialog), 모델·메시 `public/physics/<g1|go2>/`.
- UI: 시퀀스 막대/트랙 우클릭 `물리 검증`, 막대 배지(✓ 평균·최대 % 체중 / ⚠ / 오래됨 / 미지원), 메뉴 ▸ `물리 설정…`(kp/kd·경고 기준), 내보내기 창에서 자동 재검증·경고 `물리 보조력`(건너뛰기 가능).
- GO2 기본 kp 20은 정지 자세에서도 기준선 약 39% → 더 낮은 기준선이 필요하면 물리 설정에서 kp를 올릴 것. RL팀 kp/kd 확정 시 기본값 교체.
- 개발 모드 훅 `window.__physics`(`usePhysics`, `stale`) — e2e용(`e2e/physics.spec.ts`).

## 알려진 남은 항목

- 기본자세 덧붙이기: 조각 시작이 크로스페이드 안이면 덧붙인 마지막 프레임과 첫 프레임 사이에 작은 차이가 날 수 있음.
- GO2 RobotType 코드 1은 추정값(GO2 샘플 CSV로 확인 필요).
