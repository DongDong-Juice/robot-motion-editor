# 모션 편집기 M3(참조 영상) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람 동작 영상을 가져와 V1 트랙에 배치·트림하고, 무대 뷰어에 오버레이(투명도) 또는 분할로 띄워 재생헤드와 프레임 단위로 동기화한다.

**Architecture:** 프로젝트에는 `Media {id, name, durationF}`와 V1 트랙의 Item만 저장한다(경로·바이너리 없음). 실제 파일은 런타임 레지스트리(`mediaUrls`: mediaId → object URL)에만 있고, 프로젝트를 열면 "오프라인"으로 표시되어 재연결한다. 영상 시간 계산은 순수 함수 `videoTimeAt` 하나로 모으고, 뷰어의 `<video>`는 그 결과만 따른다.

**Tech Stack:** 기존과 동일. 새 의존성 없음. 테스트용 영상은 ffmpeg로 생성(개발 PC에 설치됨, 테스트 실행 시 없으면 해당 e2e skip).

**Spec:** `docs/superpowers/specs/2026-10-07-robot-motion-editor-design.md` (M3 = 10절 3번; 3·4·5절 참조 영상·Media·V1)

## Global Constraints

- M1·M2 Global Constraints 전부 유지 (60fps 정수 프레임, CSV 형식, 의존성 4개, 파일 API는 `src/fileio.ts`만, 토큰·서체·금지 스타일, `edit(fn, touched)`의 채널 선언 규칙과 dev freeze).
- 프로젝트 파일에 영상 경로·데이터 저장 금지. `Media = { id, name, durationF }`.
- 영상은 CSV 내보내기·검증·궤적에 영향 없음.
- V1 트랙은 시퀀스에 최대 1개, 트랙 목록 맨 위. Item끼리 겹침 금지(크로스페이드 없음). `0 ≤ trimIn < trimOut ≤ media.durationF`.
- 영상은 항상 음소거.
- 문구는 한국어, 버튼은 동작 이름.

## Review Focus

1. 프로젝트를 다시 연 뒤 영상이 없는 상태 → 오프라인 표시, 재생·스크럽·내보내기 모두 정상, 콘솔 오류 없음 (Task 3·4).
2. 재생 중 스크럽/In-Out 루프/클립 보기 전환 → 영상 시각이 재생헤드와 2프레임 이내 (Task 4 테스트).
3. 영상 Item 범위 밖 프레임 → 영상 숨김(검은 화면 아님), 다음 Item 진입 시 다시 표시 (Task 1 `videoTimeAt` 테스트).
4. 쓰이는 미디어 삭제, 영상보다 길게 트림, V1에 모션 클립 드롭 / 모션 트랙에 영상 드롭 → 거부 + 문구 (Task 1·3).
5. 저장 파일 검증: media 참조 누락, durationF 비정수/음수, V1 2개 → 열기 거부 (Task 1).

---

## 파일 구조

```
src/model/types.ts            (수정) Media 타입, Project.media: Media[]
src/model/video.ts            (신규) videoTimeAt, validVideoTrack — 순수
src/model/projectFile.ts      (수정) media·V1 검증
src/store/store.ts            (수정) addMedia, deleteMedia, addVideoItem; move/trim/split/delete가 V1 Item도 처리
src/media/registry.ts         (신규) mediaUrls 레지스트리(런타임 전용), probeDuration
src/fileio.ts                 (수정) openMediaFiles
src/project/ProjectPanel.tsx  (수정) "미디어" 섹션, 영상 가져오기, 재연결, 드래그
src/timeline/SequenceCanvas.tsx (수정) V1 행
src/viewer/VideoOverlay.tsx   (신규) <video> 오버레이/분할, 동기화
src/viewer/Stage.tsx, src/App.tsx, src/styles.css (수정) 보기 모드 토글
e2e/video.spec.ts             (신규)
```

---

### Task 1: 모델 — Media, V1 규칙, videoTimeAt, 파일 검증

**Files:**
- Modify: `src/model/types.ts`, `src/model/projectFile.ts`, `src/model/sequence.ts`(validTrack 호출부 확인), `src/store/store.ts`
- Create: `src/model/video.ts`, `src/model/video.test.ts`
- Test: `src/store/store.test.ts`, `src/model/projectFile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  interface Media { id: string; name: string; durationF: number }
  Project.media: Media[]
  // video.ts
  function videoTrack(p: Project): Track | null                         // kind 'video' 트랙 (최대 1)
  function validVideoTrack(items: Item[], media: Record<string, Media>): boolean   // start≥0, 0≤trimIn<trimOut≤durationF, 겹침 없음
  function videoTimeAt(p: Project, frame: number): { mediaId: string; seconds: number; itemId: string } | null
     // frame을 덮는 V1 Item → seconds = (frame − start + trimIn) / 60; 없으면 null
  // store
  addMedia(name: string, durationF: number): string          // V1 트랙이 없으면 맨 위에 생성. undo 1개. 이름 중복 시 _2
  deleteMedia(mediaId: string): boolean                      // 어떤 Item도 참조하지 않을 때만
  addVideoItem(mediaId: string, start: number): boolean      // trimIn 0, trimOut durationF; validVideoTrack 실패 시 false
  ```
- 기존 `moveItem`/`trimItem`/`splitItem`/`deleteItem`/`selectItem`은 V1 Item에도 동작: 트랙 kind가 `video`면 `validVideoTrack`, `trimOut` 상한 = `durationF`. `addItem`(모션)은 V1 트랙 거부. 영상 편집은 `touched` 채널 없음(`[]`).
- `parseProject`: media 각 항목 `id`/`name` 문자열, `durationF` 정수 ≥1, id 중복 금지; video 트랙 0~1개, actorId 없음, Item.refId가 media에 있음(`Object.hasOwn`), `validVideoTrack`.
- 기존 프로젝트 파일(`media: []`, video 트랙 없음)은 그대로 열린다.

- [ ] **Step 1: 실패 테스트**
  ```ts
  test('videoTimeAt maps frame to media seconds with trims', () => {
    // media 600f, item start 120 trimIn 60 trimOut 300
    expect(videoTimeAt(p, 119)).toBeNull()
    expect(videoTimeAt(p, 120)).toEqual({ mediaId, itemId, seconds: 1 })
    expect(videoTimeAt(p, 359)?.seconds).toBeCloseTo(299 / 60)
    expect(videoTimeAt(p, 360)).toBeNull()
  })
  test('validVideoTrack rejects overlap and over-length trim', () => { /* … */ })
  test('addMedia creates single V1 on top; deleteMedia refuses used media', () => { /* … */ })
  test('trimItem on video item bounded by durationF; splitItem works on video', () => { /* … */ })
  test('addItem (motion clip) onto video track rejected; addVideoItem onto overlap rejected', () => { /* … */ })
  test('parseProject: old file with media [] opens; dangling media ref / two video tracks / durationF 0 rejected', () => { /* … */ })
  ```
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `npx vitest run`, `npx tsc -b` PASS.
- [ ] **Step 5:** Commit `feat(model): media, V1 video track rules, videoTimeAt`.

---

### Task 2: 미디어 레지스트리 + 가져오기 + 재연결 (프로젝트 패널)

**Files:**
- Create: `src/media/registry.ts`, `src/media/registry.test.ts`
- Modify: `src/fileio.ts`, `src/project/ProjectPanel.tsx`, `src/styles.css`

**Interfaces:**
- Produces:
  ```ts
  // registry.ts — 프로젝트 밖 런타임 상태. zustand 미사용, 구독 가능.
  function setMediaUrl(mediaId: string, url: string): void          // 이전 URL revoke
  function mediaUrl(mediaId: string): string | null
  function clearMedia(): void                                        // 프로젝트 열기/새 프로젝트 시 전체 revoke
  function subscribeMedia(fn: () => void): () => void
  async function probeDuration(url: string): Promise<number>         // <video> loadedmetadata → Math.round(duration*60); 실패 시 throw "영상을 읽을 수 없습니다"
  // fileio.ts
  async function openMediaFiles(multiple: boolean): Promise<File[]>  // video/* ; 취소 → []
  function objectUrl(file: File): string                             // URL.createObjectURL 래퍼 (파일 API는 fileio에만)
  ```
- ProjectPanel "미디어" 섹션(클립 섹션 아래): 행 = 이름 · 길이(초) · 상태("오프라인"이면 `--accent` 글자). 버튼 "영상 가져오기"(여러 개). 가져오기 = 파일마다 URL 생성 → `probeDuration` → `addMedia(name, durationF)` → `setMediaUrl`. 실패 파일은 "<이름>: <이유>" 목록. 오프라인 행에는 "다시 연결" 버튼 → 파일 하나 선택 → `setMediaUrl` (길이가 다르면 "길이가 다른 영상입니다(<a>초 ≠ <b>초)" 경고만 표시하고 연결은 함). 행 `draggable`, 타입 `application/x-motion-media`. 삭제 = `deleteMedia`(거부 문구 "시퀀스에서 쓰는 영상은 삭제할 수 없습니다").
- `loadProject`·`newProjectFile` 호출 시 `clearMedia()` (Task 2에서 `projectActions.ts`에 연결).
- 레지스트리 테스트: set/revoke(`URL.revokeObjectURL` 호출 확인, 테스트에서 stub), subscribe 알림, clear.

- [ ] **Step 1:** 레지스트리 실패 테스트 → FAIL → 구현 → PASS.
- [ ] **Step 2:** 패널·fileio 구현.
- [ ] **Step 3:** 브라우저(Playwright, scratchpad): ffmpeg로 2초 테스트 영상(`ffmpeg -f lavfi -i testsrc=size=320x240:rate=30 -t 2 -pix_fmt yuv420p test.mp4`) 생성 → 가져오기 → 미디어 행 "2.00초" → 저장 → 새 프로젝트 → 열기 → "오프라인" → 다시 연결 → 상태 정상.
- [ ] **Step 4:** `npx vitest run`, `npx tsc -b`, `npm run e2e`.
- [ ] **Step 5:** Commit `feat(media): import videos, runtime url registry, relink offline media`.

---

### Task 3: V1 트랙 UI (시퀀스 보기)

**Files:**
- Modify: `src/timeline/SequenceCanvas.tsx`, `src/transport.ts`(C·Delete가 V1 Item에도)

**Interfaces:**
- Consumes: Task 1 `videoTrack`, `addVideoItem`, 기존 `moveItem`/`trimItem`/`splitItem`/`deleteItem`/`selectItem`; Task 2 `mediaUrl`, `subscribeMedia`.
- V1 행: 시퀀스 보기 맨 위, 라벨 "V1 참조영상". 미디어가 하나도 없으면 행을 그리지 않음.
- Item 막대: `--panel` 바탕 + `--line` 테두리, 미디어 이름. 오프라인이면 사선 해칭 + 이름 뒤 " (오프라인)". 선택 테두리 `--accent`. 이동·양끝 트림·더블클릭 없음(클립 보기 없음)·C 자르기·Delete — 모션 Item과 같은 조작.
- 드롭: `application/x-motion-media` → V1 행에서만 `addVideoItem(media, xToFrame)`; 모션 행에 영상 드롭 = "영상은 V1 트랙에만 놓을 수 있습니다", V1에 클립 드롭 = "V1 트랙에는 영상만 놓을 수 있습니다", 겹침 = "영상 클립은 겹칠 수 없습니다". (2초 한 줄, 기존 메시지 방식)
- 실패한 이동·트림은 기존과 같이 되돌아감 + "이 위치에 놓을 수 없습니다".

- [ ] **Step 1:** 구현 (UI 전용; 로직은 Task 1 테스트가 담보).
- [ ] **Step 2:** 브라우저: 영상 드롭 → 막대, 이동·트림(영상 길이 초과 거부)·C·Delete, 잘못된 드롭 3종 문구, 오프라인 해칭 스크린샷.
- [ ] **Step 3:** `npx vitest run`, `npx tsc -b`, `npm run e2e`.
- [ ] **Step 4:** Commit `feat(timeline): V1 reference video track`.

---

### Task 4: 무대 영상 오버레이·분할 + 동기화

**Files:**
- Create: `src/viewer/VideoOverlay.tsx`, `src/viewer/videoSync.ts`, `src/viewer/videoSync.test.ts`
- Modify: `src/viewer/Stage.tsx`, `src/App.tsx`, `src/styles.css`, `src/store/store.ts`(보기 상태)

**Interfaces:**
- Produces:
  ```ts
  // store (UI 상태, 실행취소·dirty 대상 아님)
  videoMode: 'off' | 'overlay' | 'split'; videoOpacity: number    // 기본 'overlay', 0.5
  setVideoMode(m): void; setVideoOpacity(v: number): void          // 0..1 클램프
  // videoSync.ts — 순수
  function syncAction(target: { seconds: number } | null, video: { currentTime: number; paused: boolean }, playing: boolean):
    { kind: 'hide' } | { kind: 'seek'; t: number; play: boolean } | { kind: 'none'; play: boolean }
    // target null → hide. 재생 중: |currentTime − t| > 2/60 이면 seek, 아니면 none(play=true). 정지: |Δ| > 0.5/60 이면 seek(play=false)
  ```
- VideoOverlay: `<video muted playsInline preload="auto">` 1개. 매 프레임(store 구독) `videoTimeAt(project, 시퀀스 프레임)` → mediaId의 URL로 `src` 교체(바뀔 때만) → `syncAction` 적용. URL 없음(오프라인) → hide. 클립 보기에서도 시퀀스 프레임 기준(클립 보기 재생헤드의 시퀀스 프레임)으로 동기화.
- 오버레이: 무대 위 절대 위치, `object-fit: contain`, `opacity = videoOpacity`, `pointer-events: none` (기즈모 조작 방해 금지). 분할: 무대 영역을 좌(영상)/우(3D) 1:1로 나누고 three 렌더러 크기 재계산(기존 ResizeObserver 경로). 끄기: 숨김 + `pause()`.
- 메뉴바(또는 무대 우상단)에 "영상: 끄기 / 오버레이 / 분할" 세그먼트 버튼 + 오버레이일 때만 투명도 슬라이더(`aria-label="영상 투명도"`). V1에 Item이 없으면 컨트롤 숨김.

- [ ] **Step 1: 실패 테스트** (`videoSync.test.ts`)
  ```ts
  test('null target hides', () => expect(syncAction(null, v(0, true), true).kind).toBe('hide'))
  test('playing within 2 frames does not seek', () => expect(syncAction({ seconds: 1 }, v(1 + 1/60, false), true)).toEqual({ kind: 'none', play: true }))
  test('playing drift > 2 frames seeks', () => expect(syncAction({ seconds: 1 }, v(1.1, false), true)).toEqual({ kind: 'seek', t: 1, play: true }))
  test('paused scrub seeks precisely', () => expect(syncAction({ seconds: 2 }, v(1.99, true), false)).toEqual({ kind: 'seek', t: 2, play: false }))
  ```
- [ ] **Step 2:** FAIL → 구현 → PASS.
- [ ] **Step 3:** 브라우저: 테스트 영상(ffmpeg `testsrc`, 프레임 번호가 보이는 영상: `-vf drawtext` 대신 `testsrc`의 타이머 사용) 배치 → 스크럽 시 `video.currentTime`이 기대값 ±1/60, 재생 3초 후 차이 ≤ 2/60, In/Out 루프 경계 통과 후 재동기화, 분할 모드에서 3D 캔버스 폭 절반, 오버레이에서 기즈모 드래그 정상, 오프라인 상태에서 오류 없음.
- [ ] **Step 4:** `npx vitest run`, `npx tsc -b`, `npm run build`, `npm run e2e`.
- [ ] **Step 5:** Commit `feat(viewer): reference video overlay/split synced to playhead`.

---

### Task 5: E2E — 영상

**Files:**
- Create: `e2e/video.spec.ts`

- [ ] **Step 1: 테스트**
  ```ts
  // beforeAll: ffmpeg 있으면 testsrc 2초 mp4를 test-results 임시 경로에 생성, 없으면 test.skip('ffmpeg 없음')
  test('import video, place on V1, scrub syncs', async ({ page }) => {
    // 미디어 가져오기(filechooser) → __editor로 addVideoItem(media, 60) → setFrame(90)
    // → video.currentTime ≈ 0.5 (±1/60) ; setFrame(30) → <video> 숨김
  })
  test('save/reopen marks media offline, relink restores', async ({ page }) => {
    // 저장 → 새 프로젝트 → 열기 → 미디어 행 "오프라인" → 다시 연결(filechooser) → 오프라인 표시 사라짐, 콘솔 오류 0
  })
  ```
- [ ] **Step 2:** `npm run e2e` 2회 연속 PASS (기존 4개 포함).
- [ ] **Step 3:** `npx vitest run`, `npx tsc -b`, `npm run build` PASS.
- [ ] **Step 4:** Commit `test(e2e): reference video import, sync, relink`.
