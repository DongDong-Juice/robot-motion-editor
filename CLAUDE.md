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
npm run serve      # 배포: dist + 프로젝트 허브 API (PORT 기본 8080, PROJECT_DIR 기본 ./projects)
```

- 브라우저 수동 확인용 Playwright 스크립트는 **저장소 밖**에 두고 `npx vite --port 5199`로 띄운 뒤 반드시 종료.
- headless Chromium은 기본이 소프트웨어 WebGL이라 느림 → `--enable-gpu --ignore-gpu-blocklist --use-angle=d3d11`.
- 개발 모드 훅: `window.__editor`(zustand StoreApi), `window.__stage`/`__stages`, `window.__tv`.

## 기술 스택과 제약

- Vite + React 19 + TypeScript + three.js + zustand. 런타임 의존성은 이 넷 + `@mujoco/mujoco@3.15.0`(물리 검증, 웹 워커).
- **파일 API는 `src/fileio.ts`에만**(Tauri/Electron 래핑 시 교체 지점).
- 60 fps 고정, 정수 프레임.
- 색 토큰: `--bg #22262D`, `--panel #2B3038`, `--line #3B424D`, `--text #D5DAE1`, `--accent #F0A43A`, G1 `#58B4D1`, GO2 `#C9D65A`, 기본자세 조각 `--rest #A98BE0`, 전이 `--blend #7D9BEA`, 관성 구간 `--inertia #E58FB0`, 보조 문구 `--dim #8d96a3`(캔버스 `DIM`), 경고 `--warn #E5484D`(캔버스 `WARN_RED`). 서체 IBM Plex Sans KR, 수치 `tabular-nums`. 대문자 라벨·그림자·그라데이션 금지.

## CSV 형식 (가져오기·내보내기 공통 — RL 학습 입력)

- 1행 헤더: `frequency(fps),RobotType,DOF Number,time(ms),position X(m),position Y(m),position Z(m),quaternion X,quaternion Y,quaternion Z,quaternion W,<URDF 관절 이름>,` (끝 쉼표)
- 행: `60,<0=G1|1=GO2>,<29|12>,round(i*1000/60),x,y,z,qx,qy,qz,qw,q…,` (모든 줄 끝 쉼표, 마지막 줄 줄바꿈 없음, 소수 6자리). G1 41열, GO2 24열.
- 관절 열 순서 = `RobotDef.joints` = URDF revolute 순서 (GO2: FL, FR, RL, RR — 사용자 확정).
- 가져오기 경로: 메뉴 ▸ CSV 가져오기, 또는 목록 패널에 CSV 파일을 끌어다 놓기(`importDroppedFiles`, 같은 처리·CSV 아닌 파일은 건너뛰고 목록에 표시). 목록의 `폴더 가져오기`(`importCsvFolder`, 사용자): 고른 폴더(하위 폴더 포함)의 CSV를 같은 이름의 목록 폴더에만 넣음(타임라인에는 안 놓음).
- 가져오기는 헤더 이름으로 열 매칭, DOF로 로봇 판별, fps 30이면 60으로 리샘플. 헤더 없는 36/19열 구형식도 지원.
- 내보내기 루트: 로컬(첫 프레임 x·y·yaw = 0, 기본) / 월드.
- 파일 이름: GO2 조각은 모두 `<프로젝트>-GO2-<n>.csv`(n = 그 트랙 시작 순, 라이브러리 블럭 포함, 사용자). G1은 `<G1, 같은 로봇 액터가 여럿이면 액터 이름>_<클립>.csv`. 한 클립을 여러 조각이 쓰면(잘린 조각) `<프로젝트>-<G1|GO2>-<n>.csv`(n = 시작 순, 조각 이름과 같음). 겹치면 `_2`…
- 테스트 예제: `assets/examples/`(합성 G1·GO2 CSV 형식별·경고·오류 파일 + 예제 프로젝트, README 참고). `node tools/make_examples.mjs`로 다시 생성.
- 샘플: `assets/data/Track1_원본_합본.csv`(12,638행, G1). `assets/video/Track1.mov`(참조 영상, 395 MB)는 **git 미포함** — 원본 PC에서 따로 옮길 것.

## 구조

```
src/robot/     RobotDef 로드(public/robots/<g1|go2>/model.json, meshes.json)
src/model/     types, curve(베지어/선형/홀드), pose(evaluateClip), sequence(여러 Item·크로스페이드·루트 이어붙이기),
               evaluate(시퀀스→월드 포즈), projectFile(v2 압축 저장·v1 읽기, 확장자 `.mproj` — 예전 `.motion.json`도 열고 저장은 `.mproj`), restPose, simplify, video, defaults
src/store/     zustand 스토어(edit(fn, touched) 채널 단위 구조 공유·dev freeze, tryEdit, 제스처 실행취소, 잠금 규칙)
src/export/    csv(samplePoses·posesToCsv·exportItemCsv·withRestPose), validate, importCsv, ExportDialog, exportOne
src/timeline/  SequenceCanvas(시퀀스·트리·V1), TrackCanvas·GraphCanvas(클립 보기), ruler, follow(재생헤드 따라가기), assetDrop
src/viewer/    Stage(패널별 three.js 인스턴스), StagePanes(영상/로봇/클립·비교 프리뷰 도킹), VideoOverlay, follow(카메라)
src/project/   ProjectPanel(탭·필터·⇄비교), AssetList(트리·폴더·우클릭), LibraryList(GO2 블록), binTree, CsvFpsDialog
src/media/     영상 URL 레지스트리(프로젝트에 저장 안 함 → 열면 오프라인, 재연결)
src/layout/    패널 크기 조절
tools/urdf_to_json.py   URDF+DAE → RobotDef JSON (GO2 생성에 사용)
server/        hub.mjs(프로젝트 허브 API, dev·배포 공통), index.mjs(배포 서버, node:http 의존성 없음)
```

핵심 불변식:
- **미리보기 = CSV**: 뷰어와 내보내기 모두 `evaluate`/`exportItemCsv`만 사용.
- 클립은 공유 데이터(잘린 조각·재배치가 같은 클립 참조). 기본자세(차렷 = `RobotDef.rest`, 로봇별 관절각·바닥 높이, `loadRobot.ts` `REST`)는 클립을 바꾸지 않고 Item의 `restPose` 표시(덮어쓰기는 없앰(사용자) — 예전 파일의 `true`는 열 때 꺼짐 / `'prepend'` 덧붙이기: 앞에 리드인 = 차렷 정지(`restHold`, 기본 30) → 전이(`restBlend`, 기본 60, `'auto'` = 관절 속도 한계 50%로 최소 길이) → 관성(`inertia`, 자른 위치 앞 원본 프레임, 없으면 자동 판정 `model/inertia.ts`: 1.5 s 안에서 조용한 지점·움직임 바닥까지 거슬러 올라감, 못 찾으면 '검토 필요'; 조각 수정 층이 있으면 `itemClip` 기준). 길이는 `leadOf`/`itemLead`/`restLead(p, defs, item)`로만 구함, 조각마다 클립 프리뷰의 리드인 설정 줄에서 바꿈. 전이 끝 속도 = 관성 시작 속도, 루트 x·y·yaw는 정지·전이 동안 관성 시작 값에 고정(사용자 확정: 드리프트 없음), 다리는 전이 동안 IK로 다시 풀어 발이 바닥에서 미끄러지지 않음(사용자 확정: "드리프트 하면 안된다"): 발마다 그대로 딛고 있거나, 들어서 모션 첫 프레임 자리에 내려놓음, 한 발씩 차례로(`model/legIk.ts` `stepPlan`·`solveLeg`, G1 발 위치+기울기, GO2 발 끝 위치). 관성 자동은 두 발이 딛고 선 프레임에서만 시작(`footContact`, 없으면 '발이 떠 있음' 경고), 전이가 걸음에 비해 짧으면 '걸음이 빠름' 경고. 회귀 검사 `src/model/leadIn.sweep.test.ts`(Track1 샘플을 여러 위치에서 잘라 발 미끄러짐·공중 정지·순간이동·관절 속도 확인) — 리드인 코드를 바꾸면 반드시 통과시킬 것, CSV +리드인 행, 물리 그래프는 `seqFrameOf`로 오프셋. 스펙 `docs/superpowers/specs/2026-10-14-inertia-lead-in-design.md`) → **클립 프리뷰와 그 조각 CSV에만** 반영, 메인 타임라인 재생은 원본(사용자 확정: 메인 트랙에선 기본자세 안 함). 자르기(C, 또는 시퀀스 상단 `자르기` 버튼 = 입력한 시퀀스 프레임에서 같은 대상 규칙 `cutAtFrame`)는 양쪽 조각에 기본자세 덧붙이기를 켬(사용자: 자르면 디폴트로 켜짐, 끄기는 클립 프리뷰 스위치). 대신 **끝 기본자세**(`Item.restTail`)를 켬: 왼쪽 조각 `??= true`(사용자가 끈 `false`는 유지), 오른쪽 조각 `true`(사용자 확정: 자를 때마다 각 조각 끝에 기본자세). 끝 기본자세 = 마지막 프레임 뒤 전이(자동) → 차렷 정지 0.5 s, 조각 끝을 뒤집어 덧붙이기 리드인을 만들고 다시 뒤집음(`appendRestPose`·`tailOf`·`itemTail`·`tailedClip`, 드리프트·발 미끄러짐 없음). 클립 프리뷰와 조각 CSV에만(CSV 끝 행 `restTailRows`), 레인은 막대 뒤 `전이`·`기본자세` 블록, 클립 프리뷰 `끝 기본자세` 버튼으로 켜고 끔(`setRestTail`). 레인 색 블록의 바깥 경계를 끌면 그 길이가 바뀜(사용자): 리드인은 왼쪽 경계(기본자세·전이·관성, 조각 시작 고정), 끝은 오른쪽 경계(전이 `Item.tailBlend`·기본자세 `tailHold`, 없으면 자동·0.5 s), 놓을 때 `setRestLead` 한 번(실행취소 1번). 회귀 검사 `src/model/restTail.sweep.test.ts`. 스펙 `docs/superpowers/specs/2026-10-14-cut-rest-tail-design.md`. 타임라인 표시: 트랙을 펼치면(▾, 조각이 늘어 2개 이상이 되면 자동) 조각마다 아래로 한 줄씩 계단식 레인에 실제 막대가 놓이고(이동·트림·우클릭·물리 그래프 모두 레인에서), 트랙 줄은 이름만. 기본자세 구간만 `--rest` 색: 덧붙이기 = 조각 시작 바로 앞 리드인(기본자세(정지) `--rest`·전이 `--blend`·관성 `--inertia` 세 색 블록, 각각 "기본자세"·"전이"·"관성" 라벨, 검토 필요면 레인 라벨 앞 ⚠; 한 줄로 접으면 얇은 띠). 클립 프리뷰는 **자기 재생헤드**(`previewFrame`/`previewPlaying`, 시퀀스 프레임 좌표)를 씀(사용자 확정: 로봇 프리뷰와 재생헤드 공유 X). 타임라인에서 조각(레인 라벨·막대)을 누르면 열리며 그 조각 구간(리드인~끝 기본자세, `previewRange`)을 자동 반복 재생, 메인 재생헤드는 그대로(`openItemPreview(id, true)`, `transport` 의 프리뷰 시계). 창에 재생 버튼 없음(사용자), 타임라인에 점선으로 위치 표시. 조각 더블클릭 = 클립 프리뷰를 닫고 그 조각을 클립 보기(메인 3D에서 편집, 트랙/그래프)로 엶 — 타임라인 창은 그 조각 프레임(trimIn~trimOut)과 덧붙이기 리드인(기본자세·전이·관성)·끝 기본자세 구간에 맞춤(`previewRange`, 구간은 색 블록·라벨 `drawPieceBounds`), 재생·화살표 범위도 그 구간(`playRange`), 그 밖은 빈 배경. 리드인·끝 구간에서는 메인 3D가 프리뷰·CSV와 같은 자세(`leadInPose` + `placeItemPose`), 그 프레임은 편집 잠금(조각 자체 프레임이 아님). 클립 보기 트랙에는 수정 키만 표시(클립 원래 키는 안 그림). 그 조각 편집(프리뷰 기즈모·관절 패널)은 프리뷰 재생헤드 프레임에(`editTarget`), 리드인·끝 기본자세 구간에서는 프리뷰 기즈모 없음. 프리뷰 좌표 = 메인과 같은 시퀀스 프레임이라(조각 start = 프리뷰 첫 프레임, 덧붙이기면 리드인 시작 = 조각 start − 리드인 길이가 첫 프레임 → 프리뷰·레인·물리 그래프·CSV 행이 같은 시각에 맞음). 스펙 `docs/superpowers/specs/2026-10-12-restpose-prepend-design.md`.
- 무대(`Project.stage`, 기본 10×6 m, 원점 중심, 객석 = +X): 3D 창마다 `무대` 버튼(기본 켜짐, 메인 = 스토어 `stageShown`), 크기는 인스펙터 `무대` 섹션(메인 무대가 켜졌을 때), 표시 전용. 스펙 `docs/superpowers/specs/2026-10-19-stage-setup-design.md`.
- 3D 패널 언마운트 시 `renderer.forceContextLoss()` 필수(WebGL 컨텍스트 누수로 메인 프리뷰가 꺼졌던 버그, `e2e/webgl.spec.ts`).
- 여러 클립 드롭(사용자, `dropClips`): 목록 폴더를 끌거나 여러 개 골라 끌면 클립마다 조각 하나씩 목록 순서대로 놓은 자리부터 이어 붙임, G1·GO2는 각자 로봇 트랙(놓은 줄이 같은 로봇이면 그 트랙, 아니면 그 로봇 첫 트랙, 없으면 새 로봇), 빈 타임라인이면 모두 0부터, 실행취소 1번.
- 에셋 드롭은 겹침을 만들지 않고 떨어뜨린 자리에 끼워 넣음(사용자, `dropPlacement` `insertAt`): 조각 위면 가까운 경계(앞쪽 절반 = 그 조각 앞, 뒤쪽 절반 = 뒤)에 넣고 그 뒤 조각들을 새 클립 길이만큼 밀어냄(간격·크로스페이드 유지), 빈 틈이면 떨어뜨린 프레임에 넣고 뒤 조각은 필요한 만큼만 밂. 영상(V1)은 예전대로 겹치면 뒤에 붙임. 크로스페이드는 타임라인에서 직접 겹칠 때만.
- 목록 패널 = 탭(`모션(CSV)|영상|라이브러리`)·제목 필터·가상 폴더(`Project.bins`, `Clip.bin`/`Media.bin`, 한 단계, 폴더 삭제 시 항목은 최상위). GO2 블록은 라이브러리 탭에만(메뉴·창·인스펙터 패널 없음): 고른 블록 `Go2BlockPanel`로 `추가`(`붙일 로봇` 기본 = 선택 GO2 → 첫 GO2 → 새 GO2, `목록에만 추가`도 고를 수 있음), 고정 블록은 템플릿 로드 후 타임라인으로 끌기(`Asset.clip` = 새 클립, 드롭과 클립 추가가 실행취소 1회). 스펙 `docs/superpowers/specs/2026-10-16-project-panel-design.md`.
- 트랙의 마지막 클립을 지우면 그 액터·트랙도 삭제(클립은 에셋에 남음). 잘린 조각을 지우면 이웃 조각에 합쳐짐(사용자: 원본 CSV가 끊기지 않게, `deleteItem`): 바로 앞 조각이 같은 클립·원본 프레임이 이어지고(앞 trimOut = 지운 trimIn) 타임라인에서도 붙어 있으면 앞 조각이 그 구간까지 늘어남(끝 기본자세는 지운 조각 값), 맨 앞 조각이면 같은 조건의 뒤 조각이 앞으로 늘어남(앞쪽 기본자세·리드인 설정은 지운 조각 값). 지운 조각의 수정은 사라짐. 합칠 수 없으면 그냥 지우고 빈칸(뒤 조각을 당기지 않음). 레인 막대를 위아래로 끌어 같은 트랙의 다른 조각 레인에 놓으면 두 조각이 순서를 맞바꿈(사용자, `swapItems`): 조각들이 끝에 붙어 다시 흐르고 자리마다 앞 조각과의 간격·겹침은 그대로, 끄는 동안 놓을 레인에 점선 테두리.
- GO2 이음매 보정(사용자, 스펙 `docs/superpowers/specs/2026-10-19-go2-seam-blend-design.md`, `model/seam.ts`): 같은 트랙에서 앞 조각 끝 = 뒤 조각 시작인 GO2 조각은 뒤 조각 앞 N프레임(`Item.seam`, 기본 20, 항상 켜짐)에 앞 끝 자세·속도와의 차이를 더해 0으로 줄임(관절·z·roll·pitch, x·y·yaw는 루트 이어붙이기). `itemClip`에 들어가 재생·프리뷰·CSV·물리 공통, 편집기는 `editedClip`(보정 전). 블럭 CSV·길이는 그대로. 레인에 뒤 조각 앞쪽 `--blend` 띠, 오른쪽 경계를 끌어 길이(0 = 끔), 차이가 크면(관절 45°·높이 5 cm 초과) 빨간 띠 + 레인 라벨 ⚠. G1은 없음.
- 조각 숨기기(`Item.hidden`, 레인의 눈 아이콘): 트랙 숨기기처럼 화면 전용. 재생헤드가 그 조각 안이면(크로스페이드는 둘 다 숨김일 때) 메인 3D에서 로봇을 그리지 않음(`sequence.hiddenAt`). 평가·CSV·물리는 그대로, 프로젝트에 저장.
- 프로젝트 허브·시작 화면(사용자, 스펙 `docs/superpowers/specs/2026-10-19-project-hub-design.md`): 앱을 열면 닫을 수 없는 `StartScreen` — 서버 폴더(`PROJECT_DIR`)의 `*.motion.json` 목록(누르면 열기) / `이 PC에서 열기` / 이름 + `만들기`(서버에 새 파일). 허브에서 연·만든 프로젝트의 저장(Ctrl+S)은 서버에 덮어씀, 그 사이 서버 파일이 바뀌었으면 확인 후(`base` mtime, 409). 다른 이름으로 저장·이 PC 열기·메뉴 새 프로젝트는 허브 연결 해제. 서버가 없으면 "서버에 연결할 수 없습니다", 만들기는 이름만. 서버 호출은 `fileio.ts`(`hubList`·`hubRead`·`hubWrite`). e2e는 localStorage `me.noStart`(Playwright `storageState`)로 건너뜀, 시작 화면은 `e2e/hub.spec.ts`. 인증 없음(사내망 전제).
- 잘린 조각 이름(`pieceName`, model/sequence, 사용자): GO2는 트랙의 모든 조각이 `<프로젝트>-GO2-<n>`(n = 트랙 시작 순, 블럭이 달라도, 사용자). G1은 같은 클립을 쓰는 조각이 트랙에 2개 이상이면 `<프로젝트>-G1-<n>` (프로젝트 = 저장 파일 이름에서 `.mproj`(예전 `.motion.json`) 뺀 것, 저장 전 `Untitled`(`projectTitle`), n = 시작 순이라 옮기면 다시 매겨짐, CSV 파일 이름과 같음). 막대·클립 프리뷰 제목·내보내기 목록에 표시, 레인 라벨은 `#n`(`pieceTag`), 클립 이름 자체는 그대로. 내보내기 창 항목은 G1·GO2로 묶음.
- 클립 프리뷰가 어느 조각인지(사용자: 오른쪽 패널과 매칭이 안 됨): 제목 = 액터 색 견본 + 액터 이름 / 조각 이름, 제목을 누르면 그 조각·로봇을 선택(오른쪽 패널이 따라감). 프리뷰 로봇은 그 액터 색. 타임라인에서 프리뷰 중인 조각은 막대 안쪽 점선 테두리 + 레인의 재생 버튼이 주황. 레인 눈 아이콘 왼쪽 재생 버튼: 그 조각을 클립 프리뷰에서 반복 재생, 재생 중인 조각에서 누르면 멈춤/다시 재생(`previewPlaying`).
- 경로 표시(`Track.trail`, 모션 트랙 이름 줄의 경로 아이콘, 기본 꺼짐): 로봇마다 따로 켬(사용자 확정: 전체 한꺼번에 X). 메인 3D에 그 액터의 골반 바닥 경로, 트랙을 숨기면 같이 숨김, 화면 전용·프로젝트에 저장. 클립·비교 프리뷰 창의 `경로 표시` 버튼은 그 창 로봇 하나용.
- 편집 대상 선택 없음(사용자 확정: 고치는 클립만 바뀌면 됨): 시퀀스에서는 항상 그 조각의 수정 층, 클립 편집에서는 그 클립의 수정 층에 씀. 인스펙터에는 `수정 키 n개 · 수정 지우기`만, `원본 클립 수정`·`자동 키` 버튼은 없앰(스토어 `layer: 'clip'`·`autoKey`는 테스트용으로 남음). 아래 `원본 클립 수정` 언급은 예전 동작.
- 조각 수정 층(`Item.offset`, 클립 프레임 기준 차이값 곡선): 인스펙터 기본값 `이 조각 수정`(스토어 `layer: 'piece'`)이면 슬라이더·기즈모·키 편집이 클립이 아니라 그 조각의 수정 층에 들어감(자동 키 불필요). 재생·프리뷰·CSV는 `itemClip`(원본 + 수정, 관절 한계로 자름)으로 평가. `원본 클립 수정`은 예전처럼 클립을 고침(자동 키 필요). 키 액션은 클립 ID 또는 조각 ID(`keyOwner`)를 받음. 값 편집(`setValue`: 슬라이더·숫자·기즈모)은 그 프레임 근처만 바꿈(사용자: 한 프레임 고쳤더니 계속 다리를 들고 있음): 양쪽 `OFFSET_EASE`(15프레임) 안에 키가 없으면 그 자리에 편집 전 수정 층 값 키를 넣어 원래 동작으로 돌아감(`offsetPins`). `키 추가`·`setKey`는 그대로. 스펙 `docs/superpowers/specs/2026-10-13-piece-offset-design.md`.
- 수정됨(사용자 확정: 수정본 줄·수정 비교 창 없음): 수정 층이 있는 조각은 그 레인 자체가 `수정됨` — 레인 라벨 `#2 · 0:02 수정`(초록), 막대 `… · 수정됨`, 수정 키 범위 초록 칠·키 눈금. 재생·CSV·물리·클립 프리뷰는 `itemClip`(원본 + 수정). 관절은 **클립 프리뷰에서** 눌러 기즈모로 고침(Stage `editPane` = 아이템 프리뷰, 루트는 패널 숫자로), 그 조각은 메인 기즈모 잠금(`gizmoLock` `'compare'` = 클립 프리뷰에 열린 조각). 우클릭 `수정 지우기`(`clearOffset`). 원본 겹쳐 보기(항상 켜짐, 버튼 없음 — 사용자): 재생헤드 아래 조각에 수정 층이 있으면 메인 3D에 실선 = 수정본, 초록 반투명 = 수정 전 원본(`withUse(…, 'original')`, Stage `overlays` 액터별). Delete = 조각 삭제(수정도 같이). 수정을 새 클립으로 굳히는 기능 없음(사용자: 재생·CSV 결과가 같으니 불필요). 자르면 수정이 양쪽 조각으로 복사(클립 프레임 기준). `Item.use: 'original'`는 예전 파일 호환용으로만 남음(UI 없음, `setItemUse`는 테스트용).
- 구간 프리뷰: 시퀀스에서 우클릭 드래그하면 그 구간을 자기 시계로 반복하는 `구간 프리뷰` 창이 열림(사용자, `spanPreview`, Stage `span` = 모든 로봇·읽기 전용, 드래그하는 동안 구간이 바로 바뀜). 메인 재생헤드·재생·In/Out은 그대로, 드래그하면 우클릭 메뉴 안 뜸, 눈금자·줄에 주황 칠. ✕ 또는 눈금자 우클릭(마커 없는 곳) = 닫기.
- 가장자리 자동 스크롤(사용자, `follow.ts` `edgeScroll`): 재생헤드가 마우스를 따라갈 때(호버 스크럽, 눈금자·빈 곳 드래그) 트랙 영역 90% 넘으면 오른쪽, 10% 안쪽이면 왼쪽으로 스크롤, 깊을수록 빠르게, 재생헤드는 계속 마우스 아래. 시퀀스·클립 보기 트랙·그래프 공통.
- GO2 블럭(목록 패널 라이브러리 탭, `src/go2blocks`·`src/project/LibraryList.tsx`): CSV는 `public/go2-blocks/<폴더>/`(사용자), 목록은 Vite 플러그인 `virtual:go2-blocks`가 폴더를 읽어 만듦(파일 추가·삭제 = 코드 수정 없이 반영). `리얼데이터` 폴더의 실제 로그는 손으로 만든 블럭(Move·Rotate·Hello…, `blocks.ts` KNOWN), 나머지 CSV는 고정 블럭(이름 = 파일 이름에서 앞 번호 빼고 밑줄 → 띄어쓰기, 폴더 안 번호 순). 탭은 폴더별 접기(기본 접힘, 필터에 걸리면 펼침, `Empty`만 폴더 밖 맨 위). `붙일 로봇` = 기존 GO2 트랙 끝 / 새 GO2 로봇(0초부터) / `목록에만 추가`(사용자: 목록에 등록만, 시퀀스에 안 놓음, `addClipAsset`). 기본 선택은 고른(없으면 첫) GO2 트랙, 없으면 새 GO2 로봇. 고정 블럭을 타임라인에 끌어 놓을 때도 같은 이름 클립이 있으면 그것을 씀. 블럭 이름 = 블럭 이름(옵션 블럭은 실제 값: `Rotate_168deg`, `Move_1.8m`). `Empty` 블럭 = 로그 없이 GO2 기본자세(차렷)로 서 있는 클립(`emptyBlockClip`, `Clip.hold`, 이름 `Empty_30f`): 붙일 로봇·길이 입력 없음, `추가` = 목록에만 30프레임, 라이브러리에서 타임라인으로 끌어 놓기 가능. 모든 Empty 조각이 클립 하나를 함께 씀(사용자, `emptyClipFor`): 조각 끝을 끌어 클립보다 길게 하면 클립이 늘어남(`trimItem`, 줄이면 그 조각만, 클립은 안 줄어듦 → 이름과 실제 길이가 다를 수 있음). 같은 이름이 목록에 있으면 새로 만들지 않음(사용자): 로봇 대상이면 그 클립을 트랙 끝에 붙이고(`appendClip`이 기존 클립은 복사 안 함), 목록에만이면 "이미 목록에 있습니다". 반복형 블럭(Rotate·Move)은 실제 로그의 시작·멈춤 + 걸음 n번(n ≥ 1)이라 값이 걸음 단위로만 나옴(Rotate 168°부터 약 72°씩, 우회전 −146°부터, Move 1.77 m부터 약 0.62 m씩), 입력부에 그 이유 한 줄(`stepWhy`, `blockActual`의 base·per). 값은 숫자 입력이 아니라 실제로 만들 수 있는 값 목록에서만 고름(사용자: 1 m·100°처럼 안 되는 값으로 헷갈리지 않게, `stepOptions` 방향별 1~20걸음, 기본 = 가장 작은 값). 목록은 네이티브 select가 아니라 높이 210px로 스크롤되는 `StepPicker`(사용자: 네이티브 팝업이 창 밖으로 뚫고 올라감, 높이 지정 불가), 목록은 화면 기준(fixed)으로 버튼 아래(공간 없으면 위)에 떠서 패널 크기가 안 바뀌고 잘리지도 않음(사용자: 박스 크기 바뀌는 건 별로), 창 크기 변경·스크롤 시 닫힘.
- 시퀀스 미니맵(`timeline/minimap.ts`, 예전 가로 스크롤바 자리, 높이 24px, 항상 보임): 시퀀스 전체(끝 + 반 화면)를 트랙마다 얇은 줄로, 지금 보이는 구간은 주황 상자, 재생헤드·In/Out·마커 표시, 왼쪽에 `전체 m:ss`. 상자 안 끌기 = 이동, 상자 양 끝 끌기 = 확대/축소(반대쪽 끝 고정, 0.5~40 px/프레임), 상자 밖 클릭 = 그 자리로 옮겨 계속 끌기, 더블클릭 = 전체 맞춤. 재생헤드는 안 움직임. 클립 보기(트랙·그래프)는 해당 없음.
- 시퀀스 휠: 그냥 휠은 트랙 줄 세로 스크롤만(줄이 넘칠 때만 움직임, 사용자 확정: 시퀀스 시간은 휠로 안 움직임). 시간 이동은 Shift+휠·트랙패드 좌우·아래 가로 스크롤바, Ctrl+휠은 확대/축소.
- Space = 항상 시퀀스 재생/정지(`transport.ts` 캡처 단계 `onSpace`, 포커스된 버튼·메뉴보다 먼저). 텍스트 입력·폼 컨트롤만 예외.
- 클립 편집 모드(스펙 `docs/superpowers/specs/2026-10-15-clip-edit-mode-design.md`): 목록 카드 더블클릭(또는 우클릭 `클립 편집`) = 그 클립만 가상 액터·조각(`CLIP_ACTOR`·`CLIP_ITEM`, 프로젝트에 안 들어감, `actorOf`·`targetItem`으로 찾음)에 올려 원점에서 편집, `시퀀스로`/Esc = 나가며 재생헤드·편집 대상 복원. 편집은 클립 수정 층 `Clip.offset`(차이값 곡선, 소유자 `asset:<clipId>`, layer `'asset'` = `이 클립 수정`, 자동 키 없이 씀)에, `원본 클립 수정`은 자동 키 필요. `baseClip` = 원본 + 클립 수정 층 → 모든 조각·CSV·물리가 이것 위에 조각 수정 층(`Item.offset`). `원본 보기`(누르는 동안)·`겹쳐 보기`·`CSV 저장`(`exportClipCsv`, 로컬 루트, 리드인 없음). 루트 기즈모는 잠금(패널 숫자로). 수정된 카드에 `●`. 키 줄이기는 원본 곡선만, 길이를 줄이면 수정 층 키도 자름.
- ⇄ 비교 프리뷰(목록 카드 `⇄ 비교`)는 시퀀스와 상관없이 자기 시계로 클립 전체를 반복 재생(사용자).
- 관절 기즈모(Stage, 메인·클립 프리뷰 공통, 사용자: Blender 회전 기즈모 느낌): 관절 좌표계의 X 빨강·Y 초록·Z 파랑 링 + 화면 향한 흰 링, 그 관절이 도는 축 링만 진하고 나머지는 흐림(표시만, 실제 회전은 TransformControls의 그 축 하나). 흰 링 바깥에 라벨(`.gz-tag`): 관절 이름·현재 각도·드래그 중 변화량(±)·범위, 한계 10% 안이면 빨간 테두리, 단위는 `degrees`.
- 관절 패널(`viewer/JointPanel.tsx`) = 인스펙터의 `값` 섹션(편집 대상 바로 아래, 사용자: 3D 위에 뜨면 로봇이 가려짐): 머리 도구줄(`◀ 1F`·`1F ▶` 프레임, `◀ 키`·`키 ▶`, 도/rad `degrees`, ↑↓ 관절·←→ 값 Shift ×10, 클립 보기면 구간 줄) + `몸통 (무대 위치 · 자세)` 섹션(무대 X·Y, 방향, 높이, 앞뒤·좌우 기울기, 네/두 발 위치 고정, 바닥 밀착, `바닥에 맞추기`) + 모든 부위 목록(부위마다 이름·숫자 / 슬라이더 두 줄, GO2 FR·FL·RR·RL × 고관절·허벅지·무릎). `키 추가` = 그 프레임 전 채널(`keyPose`), `키 삭제`·`보간` = 그 프레임 모든 키, `기본 서기로`(`standPose`). 부위 한정 표시·`{부위} 전체 키` 인스펙터 버튼은 없앰.
- 자세 패널(스펙 `docs/superpowers/specs/2026-10-19-pose-panel-design.md`): 클립 보기 트랙 = 로봇당 키 한 줄(◆ = 그 프레임 전 채널 키), 관절 편집은 오른쪽 관절 패널(몸통 무대 X·Y·방향·높이·기울기 + 부위 목록, GO2 FR·FL·RR·RL × 고관절·허벅지·무릎), 기본 서기로·발 위치 고정(`legIk`)·바닥 밀착(기본 꺼짐, 저장 안 함), 모든 편집 = `editPose` → `setValue`(수정 층). 메인 3D에서 로봇을 끌면 그 프레임 root.x·y(클릭만 = 관절 선택).
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
