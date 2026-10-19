# 프로젝트 허브(시작 화면) 설계

사용자 요청: 처음 들어오면 프로젝트를 고르거나 만들게 한다. "최근 프로젝트"는 서버의 지정 폴더에 있는 프로젝트 목록(클라우드 허브).
잘린 조각 이름 `<프로젝트>-<G1|GO2>-<n>`의 프로젝트 이름이 여기서 정해진다.

## 결정 (사용자 확정)

- 서버: 앱에 작은 Node 서버 추가(의존성 없음, `node:http`). 폴더 = 환경변수 `PROJECT_DIR`(기본 `./projects`, git 제외).
- 허브 범위: 목록·열기·저장. 허브에서 연 프로젝트의 Ctrl+S는 서버 파일에 덮어씀. 새 프로젝트도 서버에 만듦.
- 동시 저장: 연 뒤 서버 파일이 바뀌었으면 "다른 사람이 저장했습니다" 확인 후 덮어씀.
- 시작 화면은 닫을 수 없음(Esc 막음). 허브 목록 / 열기(내 PC 파일) / 새 프로젝트(이름) 중 하나를 골라야 함.

## 서버 API (`server/hub.mjs`, 개발 서버·배포 서버 공통)

- `GET /api/projects` → `[{ name, mtime, size }]`, `*.motion.json`만, 최근 수정 순.
- `GET /api/projects/<name>` → 파일 내용, 헤더 `X-Mtime`.
- `PUT /api/projects/<name>?base=<mtime>` → 저장, `{ mtime }`. 서버 파일 mtime ≠ base → 409 `conflict`. `?create=1` → 이미 있으면 409 `exists`. base·create 없으면 그냥 덮어씀(충돌 확인 후).
- 이름 검사: `<이름>.motion.json`, 경로 문자(`/ \ :` 등)·`..` 금지, 본문은 JSON이어야 함. 인증 없음(사내망 전제).
- 개발: Vite 플러그인으로 같은 핸들러(`npm run dev`). 배포: `npm run build && npm run serve`(`server/index.mjs`, `PORT` 기본 8080, `dist` 정적 제공).

## 클라이언트

- 서버 호출은 `src/fileio.ts`에만(`hubList`·`hubRead`·`hubWrite`). 서버가 없으면(정적 호스팅) 허브 목록 대신 "서버에 연결할 수 없습니다", 새 프로젝트는 이름만 정하고 저장은 내 PC로.
- `projectActions`: 허브 연결 상태 `{ name, mtime }`. 허브 열기·새로 만들기가 설정, 내 PC 열기·새 프로젝트(메뉴)·다른 이름으로 저장은 해제.
- 시작 화면 `src/StartScreen.tsx`: 목록(이름·수정 시각), `열기`, 이름 입력 + `만들기`. 같은 이름이 있으면 "이미 있는 이름입니다".
- e2e는 Playwright `storageState`의 localStorage `me.noStart = 1`로 시작 화면을 건너뜀(시작 화면 자체는 `e2e/hub.spec.ts`).

## 범위 밖

- 메뉴 ▸ 새 프로젝트는 그대로(이름 없이 시작). 허브 목록 삭제·이름 바꾸기·폴더 구조·잠금·인증.
