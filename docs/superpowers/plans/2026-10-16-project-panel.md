# 목록 패널 개편 (프리미어식 프로젝트 패널) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 왼쪽 목록 패널을 `모션(CSV) | 영상 | 라이브러리` 탭·제목 필터·가상 폴더(Bin)·열 리스트로 바꾸고, GO2 블록을 라이브러리 탭으로 옮긴다.

**Architecture:** 폴더는 프로젝트 파일 안의 데이터(`Project.bins`, `Clip.bin`, `Media.bin`)이고 스토어 액션 4개로만 바뀐다(각 실행취소 1회). 표시할 줄(폴더·항목·들여쓰기)은 순수 함수 `filterTree`가 만들고, `AssetList` 하나가 모션·영상 탭을 그린다(열 정의만 다름). 라이브러리 탭은 `GO2_BLOCKS` 목록 + 기존 `Go2BlockPanel` 입력부, 고정 블록은 아직 프로젝트에 없는 클립을 실은 `Asset`(`clip` 필드)으로 타임라인에 끌어 놓는다.

**Tech Stack:** React 19 + TypeScript + zustand, vitest(단위), Playwright(e2e).

**Spec:** `docs/superpowers/specs/2026-10-16-project-panel-design.md`

## Global Constraints

- UI 문구 한국어, 버튼은 동작 이름. 대문자 라벨·그림자·그라데이션 금지. 색은 `src/styles.css` `:root` 토큰(`--bg --panel --line --text --accent --dim --line-hi --warn --piece`), 수치 `tabular-nums`.
- 런타임 의존성 추가 금지(React·three·zustand·@mujoco/mujoco만). 파일 API는 `src/fileio.ts`에만.
- 재생·CSV·물리·평가 코드(`src/model/evaluate.ts`, `sequence.ts`, `restPose.ts`, `src/export/csv.ts`, `src/physics/*`)는 바꾸지 않는다.
- 폴더 편집은 스토어 액션 하나 = 실행취소 1회 + `dirty`.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 브랜치 `feat/project-panel`(→ `smjeon`에 머지, 푸시는 사용자 요청 시).
- 테스트 범위(사용자): 작업 중엔 단위 테스트 해당 파일 + **관련 e2e spec만**. 전체 실행은 푸시 직전에만.

## Review Focus

1. 옛 프로젝트 파일(bins 없음)과, 지워진 폴더를 가리키는 `bin`이 든 파일이 열리고 모든 항목이 보여야 한다 → Task 1 `projectFile` 테스트.
2. 폴더가 접힌 상태에서 필터에 걸린 항목도 보여야 한다(폴더 자동 펼침) → Task 3 `binTree` 테스트.
3. 폴더 안 마지막 클립을 지워도 빈 폴더는 (필터 없을 때) 남아 보여야 한다 → Task 3 테스트.
4. 패널 안 폴더로 끌어 넣는 드롭이 타임라인 배치 드래그를 막으면 안 된다(같은 줄을 타임라인에 놓으면 배치) → Task 4 e2e.
5. 고정 블록을 잠긴 GO2 트랙 위에 놓으면 거부 메시지, 프로젝트에 클립이 남지 않아야 한다 → Task 5 단위 테스트.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/model/types.ts` (수정) | `Bin`, `Project.bins?`, `Clip.bin?`, `Media.bin?` |
| `src/model/projectFile.ts` (수정) | bins 검증, 잘못된 `bin` 정리 |
| `src/store/store.ts` (수정) | `addBin`·`renameBin`·`deleteBin`·`moveToBin`·`addClip` |
| `src/project/binTree.ts` (생성) | `filterTree` 순수 함수 |
| `src/project/AssetList.tsx` (생성) | 모션·영상 목록(트리 줄·선택·끌기·우클릭·이름 변경·키보드) |
| `src/project/LibraryList.tsx` (생성) | GO2 블록 목록 + 입력부 + 블록 끌기 |
| `src/project/ProjectPanel.tsx` (재작성) | 탭·필터·항목 수·도구줄·CSV 파일 드롭·메시지 |
| `src/go2blocks/Go2BlockPanel.tsx` (수정) | `blockId` prop, 인스펙터 레이아웃 제거 |
| `src/model/dropPlacement.ts`, `src/timeline/assetDrop.ts`, `src/timeline/SequenceCanvas.tsx` (수정) | `Asset.clip`(새 클립) 드롭 |
| 삭제 | `src/go2blocks/Go2BlockDialog.tsx`, `FileMenu` `GO2 블럭 추가…`, `Inspector`의 `Go2BlockPanel` |

### DOM 계약 (e2e·구현 공통)

- 탭: `role="tab"` 이름 `모션(CSV)`·`영상`·`라이브러리`, 선택 탭 `aria-selected="true"`.
- 필터: `<input aria-label="필터">`, 항목 수 `.pp-count` 텍스트 `n 항목`.
- 목록: `role="tree"`, `aria-label` = `모션 목록` / `영상 목록` / `라이브러리`. 줄: `role="treeitem"` `.pp-row` + `data-kind="bin"|"clip"|"media"|"block"` + `data-id`, 이름 `.pp-name`, 폴더 줄 `aria-expanded`. 선택 줄 `aria-selected="true"`.
- 모션 열: `.pp-col-robot`(`G1`/`GO2`), `.pp-col-len`(`4.20s`), `.pp-col-uses`(숫자). 수정됨 `.pp-mod`(●). 영상: `.pp-col-len`, 오프라인이면 `다시 연결` 버튼(`aria-label="<이름> 다시 연결"`). 블록: `.pp-col-kind`(`고정`/`거리`/`각도`).
- 도구줄 버튼: `새 폴더`, `⇄ 비교`.
- 우클릭 메뉴 `role="menu"`, 하위 메뉴 `폴더로 이동` → `role="menu"` `aria-label="폴더로 이동"` 항목 `(최상위)`·폴더 이름.

---

### Task 1: 폴더 데이터 모델과 프로젝트 파일

**Files:**
- Modify: `src/model/types.ts`, `src/model/projectFile.ts`
- Test: `src/model/projectFile.test.ts`

**Interfaces:**
- Produces: `export interface Bin { id: string; name: string; tab: 'clip' | 'media' }`; `Project.bins?: Bin[]`; `Clip.bin?: string`; `Media.bin?: string`.

- [ ] **Step 1: 실패하는 테스트** (`projectFile.test.ts`, 기존 `mk`/`bad` 헬퍼 사용)

```ts
test('bins round-trip; clip/media bin kept', () => {
  const p = mk(), c = Object.values(p.clips)[0]
  p.bins = [{ id: 'b1', name: 'Walk', tab: 'clip' }, { id: 'b2', name: 'Ref', tab: 'media' }]
  c.bin = 'b1'
  const q = parseProject(serializeProject(p), defs)
  expect(q.bins).toEqual(p.bins)
  expect(q.clips[c.id].bin).toBe('b1')
})
test('a bin that is missing or of the other tab is dropped (item goes to the top level), the file still opens', () => {
  const p = mk(), c = Object.values(p.clips)[0]
  p.bins = [{ id: 'm', name: 'Ref', tab: 'media' }]
  c.bin = 'gone'
  expect(parseProject(serializeProject(p), defs).clips[c.id].bin).toBeUndefined()
  c.bin = 'm'
  expect(parseProject(serializeProject(p), defs).clips[c.id].bin).toBeUndefined()
})
test('an old file without bins opens with every item at the top level', () => {
  const q = parseProject(v1(mk()), defs)
  expect(q.bins).toBeUndefined()
  expect(Object.values(q.clips).every(c => c.bin === undefined)).toBe(true)
})
test('malformed bins are rejected', () => {
  bad(p => { p.bins = {} }, 'bins')
  bad(p => { p.bins = [{ id: 'b', name: 'x', tab: 'block' }] }, 'bins.0')
  bad(p => { p.bins = [{ id: 'b', name: 'x', tab: 'clip' }, { id: 'b', name: 'y', tab: 'clip' }] }, '중복된 ID')
})
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/model/projectFile.test.ts` → 새 4개 FAIL.
- [ ] **Step 3: 구현** — `types.ts`에 위 필드. `projectFile.ts` 읽기: `p.bins !== undefined`면 배열·항목(`id`·`name` 문자열, `tab` ∈ `clip|media`) 검증, 실패는 `fail('bins')`/`fail(\`bins.${i}\`)`, 중복 id는 `fail(\`bins.${i}.id\`, '중복된 ID입니다')`. 클립·영상 검증 뒤 `bin`이 문자열이 아니거나 같은 `tab`의 폴더가 없으면 `delete c.bin`/`delete m.bin`. 저장은 필드를 그대로 둔다(추가 코드 없음).
- [ ] **Step 4: 통과 확인** — 같은 명령, 전부 PASS.
- [ ] **Step 5: 커밋** — `feat(model): project bins (virtual folders) in the project file`

---

### Task 2: 폴더 스토어 액션과 `addClip`

**Files:**
- Modify: `src/store/store.ts`
- Test: `src/store/bins.test.ts` (생성)

**Interfaces:**
- Consumes: Task 1 타입.
- Produces (`EditorState`):
  - `addBin(tab: 'clip' | 'media', ids?: string[]): string` — 이름 `폴더 1`(같은 탭에 있으면 `폴더 2`…), `ids`(그 탭 항목)를 새 폴더로 옮김, 새 id 반환.
  - `renameBin(id: string, name: string): boolean` — trim 후 빈 이름이면 false(변경 없음).
  - `deleteBin(id: string): boolean` — 폴더 제거, 안의 항목 `bin` 삭제.
  - `moveToBin(ids: string[], binId: string | null): boolean` — 클립·영상 id 섞여도 됨, 폴더 탭이 다른 항목은 건너뜀, `null` = 최상위. 바뀐 게 없으면 false(실행취소 항목 없음).
  - `addClip(clip: Clip): string` — `addUniqueClip`로 추가(이름 중복이면 `_2`), 최상위, 클립 id 반환. Task 5 드롭이 제스처 안에서 씀.
- 클립 이동은 `touched` 없이 `p.clips[id] = { ...clip, bin }` (채널·수정 층 객체 공유).

- [ ] **Step 1: 실패하는 테스트** (`bins.test.ts`, `createEditorStore(defs)` + `loadDef`)

```ts
test('addBin names 폴더 1, 폴더 2 and takes the given items; one undo each', () => {
  const c = s().newClip('g1')
  const b1 = s().addBin('clip', [c]), b2 = s().addBin('clip')
  expect(s().project.bins!.map(b => b.name)).toEqual(['폴더 1', '폴더 2'])
  expect(s().project.clips[c].bin).toBe(b1)
  s().undo(); expect(s().project.bins!.map(b => b.id)).toEqual([b1])
  void b2
})
test('renameBin ignores a blank name', () => {
  const b = s().addBin('clip')
  expect(s().renameBin(b, '  ')).toBe(false)
  expect(s().renameBin(b, ' Walk ')).toBe(true)
  expect(s().project.bins![0].name).toBe('Walk')
})
test('deleteBin keeps its items at the top level', () => {
  const c = s().newClip('g1'), b = s().addBin('clip', [c])
  s().deleteBin(b)
  expect(s().project.bins).toEqual([])
  expect(s().project.clips[c]).toBeDefined()
  expect(s().project.clips[c].bin).toBeUndefined()
})
test('moveToBin: into a folder, back to the top, other-tab items skipped, no-op is false', () => {
  const c = s().newClip('g1'), b = s().addBin('clip'), m = s().addMedia('ref', 60), mb = s().addBin('media')
  const ch = s().project.clips[c].channels
  expect(s().moveToBin([c, m], b)).toBe(true)
  expect(s().project.clips[c].bin).toBe(b)
  expect(s().project.media.find(x => x.id === m)!.bin).toBeUndefined()
  expect(s().project.clips[c].channels).toBe(ch) // channels shared, no re-bake
  expect(s().moveToBin([c], b)).toBe(false)
  expect(s().moveToBin([m], mb)).toBe(true)
  expect(s().moveToBin([c], null)).toBe(true)
  expect(s().project.clips[c].bin).toBeUndefined()
})
test('addClip adds at the top level with a unique name', () => {
  const a = s().newClip('g1'), name = s().project.clips[a].name
  const id = s().addClip({ id: crypto.randomUUID(), name, robot: 'g1', length: 10, channels: {} })
  expect(s().project.clips[id].name).toBe(`${name}_2`)
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/store/bins.test.ts`.
- [ ] **Step 3: 구현** — 액션 5개를 `tryEdit`/`edit`로(Touched `[]`), `EditorState` 인터페이스에 한 줄 주석과 함께 추가.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `npx tsc -b`.
- [ ] **Step 5: 커밋** — `feat(store): bin actions (add/rename/delete/move) and addClip`

---

### Task 3: `filterTree` — 표시할 줄 계산

**Files:**
- Create: `src/project/binTree.ts`
- Test: `src/project/binTree.test.ts`

**Interfaces:**
- Consumes: `Bin`.
- Produces:
```ts
export interface TreeItem { id: string; name: string; bin?: string }
export type Row = { kind: 'bin'; bin: Bin; open: boolean; depth: 0 } | { kind: 'item'; id: string; depth: 0 | 1 }
export function filterTree(items: TreeItem[], bins: Bin[], query: string, open: ReadonlySet<string>): { rows: Row[]; count: number }
```
- 규칙: `bins`는 이미 그 탭 것만 들어온다. 순서 = 폴더(배열 순서, 각 폴더 줄 다음에 펼쳤으면 그 항목들, `depth 1`) → 최상위 항목(`depth 0`). 항목 순서는 입력 순서. `query`는 trim·소문자 비교로 `name`에 포함. 질의가 있으면 일치 항목이 있는 폴더만, `open: true`로 펼친 상태; 없으면 `open.has(id)`. 빈 폴더는 질의가 없을 때만 보인다. `count` = 보이는(필터를 통과한) 항목 수, 폴더 제외, 접힌 폴더 안 항목도 셈.

- [ ] **Step 1: 실패하는 테스트**

```ts
const bins = [{ id: 'w', name: 'Walk', tab: 'clip' as const }, { id: 'e', name: 'Empty', tab: 'clip' as const }]
const items = [{ id: 'a', name: 'walk_g1', bin: 'w' }, { id: 'b', name: 'Jump' }, { id: 'c', name: 'walk_turn', bin: 'w' }]
const shape = (r: { rows: Row[] }) => r.rows.map(x => x.kind === 'bin' ? `${x.open ? '▾' : '▸'}${x.bin.id}` : `${'  '.repeat(x.depth)}${x.id}`)

test('no query: folders first (collapsed unless open), empty folder shown, then top-level items', () => {
  expect(shape(filterTree(items, bins, '', new Set()))).toEqual(['▸w', '▸e', 'b'])
  expect(shape(filterTree(items, bins, '', new Set(['w'])))).toEqual(['▾w', '  a', '  c', '▸e', 'b'])
  expect(filterTree(items, bins, '', new Set()).count).toBe(3)
})
test('query: case-insensitive name match, matching folders auto-open, others and empty folders hidden', () => {
  const r = filterTree(items, bins, '  WALK ', new Set())
  expect(shape(r)).toEqual(['▾w', '  a', '  c'])
  expect(r.count).toBe(2)
  expect(shape(filterTree(items, bins, 'jump', new Set(['w'])))).toEqual(['b'])
})
test('folder names are not searched', () => {
  expect(filterTree(items, bins, 'empty', new Set()).rows).toEqual([])
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/project/binTree.test.ts`.
- [ ] **Step 3: 구현** — 위 시그니처대로.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 커밋** — `feat(project): filterTree for the bin list`

---

### Task 4: 목록 패널 — 탭·필터·모션/영상 리스트

**Files:**
- Create: `src/project/AssetList.tsx`
- Modify (재작성): `src/project/ProjectPanel.tsx`; `src/styles.css`(`.pp-*` 리스트 스타일 추가, 이 작업으로 안 쓰이게 된 `.pp-card`·`.pp-box`·`.pp-head`·`.pp-tag`·`.pp-media` 제거)
- Test: `e2e/projectPanel.spec.ts`(생성); 고칠 spec: `e2e/clipEdit.spec.ts`, `compare.spec.ts`, `csvDrop.spec.ts`, `drop.spec.ts`, `rangeEdit.spec.ts`, `sequence.spec.ts`, `video.spec.ts`

**Interfaces:**
- Consumes: Task 2 액션, Task 3 `filterTree`, 기존 `setDragged`(assetDrop), `openClipEdit`, `openComparePane`, `setClip`, `deleteClip`, `deleteMedia`, `relinkMedia`, `importDroppedFiles`, `curveKeyCount`, `mediaUrl`/`subscribeMedia`, 지금 `ProjectPanel`의 `RenameInput`·`CardMenu`·`VideoView`(옮겨 씀).
- Produces: `AssetList({ tab: 'clip' | 'media', query: string })`. 패널 상태(탭·필터)는 `ProjectPanel` 로컬 `useState`; 폴더 펼침·선택은 `AssetList` 로컬(탭마다 따로, 탭을 바꿔도 유지되게 `ProjectPanel`에서 두 `AssetList`를 `hidden`으로 유지하거나 상태를 끌어올림 — 구현 선택).

동작(스펙 §1~4, 위 DOM 계약):
- 클릭 선택, Ctrl 토글, Shift 범위(보이는 줄 기준). 모션 더블클릭 = `openClipEdit`, 폴더 더블클릭·▸ 클릭·←/→ = 접기/펼치기, ↑/↓ 줄 이동, Enter/F2 = 이름 변경(모션·폴더), Delete = 삭제(폴더는 `deleteBin`, 거부 메시지는 지금 문구 그대로), ContextMenu/Shift+F10 = 메뉴.
- 끌기: 항목 줄 `dragstart`는 지금처럼 `application/x-motion-clip|media` + `setDragged`, 거기에 패널 내부용 `application/x-motion-bin-move`(JSON id 목록: 끄는 줄이 선택에 있으면 선택 전체, 아니면 그 줄)을 함께 실음. 폴더 줄 위 `drop` = `moveToBin(ids, binId)`, 목록 빈 곳·최상위 항목 위 = `moveToBin(ids, null)`. 타임라인 드롭은 기존 경로 그대로.
- `새 폴더` = `addBin(tab, 선택 항목)` → 새 폴더를 펼치고 이름 입력 상태. `⇄ 비교` = 선택한 모션 하나(그 외 비활성).
- 영상 탭 위에 `VideoView`(지금 컴포넌트), 빈 목록 안내는 지금 문구(`메뉴 ▸ CSV 가져오기 또는 CSV 파일을 여기로 끌어다 놓으세요`)를 모션 탭에.
- 좁은 패널: CSS 컨테이너 쿼리(`container-type: inline-size`)로 220px 미만이면 `.pp-col-robot`·`.pp-col-uses` 숨김.

- [ ] **Step 1: 실패하는 e2e** — `e2e/projectPanel.spec.ts` (`importSynthetic` 헬퍼로 G1 클립 2개, `__editor`로 상태 확인):
  - `탭·필터`: `모션(CSV)` 탭 선택 상태, 줄 2개; 필터에 두 번째 이름 일부 입력 → 줄 1개, `.pp-count` = `1 항목`; `영상` 탭 클릭 → `role=tree name=영상 목록` 보임, 다시 모션 탭 → 필터 글자 유지.
  - `폴더`: `새 폴더` → `폴더 1` 이름 입력 상태, `Walk` 입력 Enter → `project.bins[0].name === 'Walk'`; 첫 클립 줄을 폴더 줄로 끌어 놓기(`dragTo`) → `clips[id].bin === bins[0].id`; `__editor.getState().undo()` → bin 없음, `redo()` → 다시 들어감; 저장·다시 열기 유지는 `page.evaluate`에서 `serializeProject`→`parseProject`→`loadProject` 후 폴더 줄·소속 확인; 폴더 우클릭 `삭제` → 폴더 사라지고 클립 줄은 최상위에 남음.
  - `끌기·편집`: 클립 줄을 타임라인(`.seq-canvas`)으로 끌기 → 시퀀스 조각 +1; 줄 더블클릭 → `clipEdit === id`; 우클릭 `폴더로 이동` 하위 메뉴에 `(최상위)` 보임.
- [ ] **Step 2: 실패 확인** — `npx playwright test e2e/projectPanel.spec.ts`.
- [ ] **Step 3: 구현** — `AssetList.tsx`, `ProjectPanel.tsx`, CSS.
- [ ] **Step 4: 통과 확인** — `npx playwright test e2e/projectPanel.spec.ts` PASS, `npx tsc -b`.
- [ ] **Step 5: 기존 spec 선택자 갱신** — `.pp-card` → `.pp-row[data-kind=clip]`, `.pp-media` → `.pp-row[data-kind=media]`(영상 탭으로 전환 후), `'사용 0'` → `.pp-col-uses` 텍스트 `0`, 카드 안 `⇄ 비교` → 줄 클릭 후 도구줄 `⇄ 비교`, 카드 `dblclick({position})` → 줄 `dblclick()`, 카드 이름 더블클릭 이름 변경을 쓰던 곳은 F2. 그다음 `npx playwright test e2e/clipEdit.spec.ts e2e/compare.spec.ts e2e/csvDrop.spec.ts e2e/drop.spec.ts e2e/rangeEdit.spec.ts e2e/sequence.spec.ts e2e/video.spec.ts` PASS.
- [ ] **Step 6: 커밋** — `feat(project): Premiere-style asset list with tabs, filter and bins`

---

### Task 5: 라이브러리 탭(GO2 블록)과 블록 창 제거

**Files:**
- Create: `src/project/LibraryList.tsx`
- Modify: `src/project/ProjectPanel.tsx`(라이브러리 탭), `src/go2blocks/Go2BlockPanel.tsx`, `src/model/dropPlacement.ts`, `src/timeline/assetDrop.ts`, `src/timeline/SequenceCanvas.tsx`(드롭 고스트 길이), `src/App.tsx`, `src/FileMenu.tsx`, `src/inspector/Inspector.tsx`, `CLAUDE.md`
- Delete: `src/go2blocks/Go2BlockDialog.tsx`
- Test: `src/timeline/assetDrop.test.ts`(생성), `e2e/go2blocks.spec.ts`(재작성), `e2e/import.spec.ts`(메뉴 항목 수)

**Interfaces:**
- Consumes: Task 2 `addClip`, `beginGesture`/`endGesture`, `GO2_BLOCKS`, `buildBlockClip`, `loadTemplate`(Go2BlockPanel 안 → `export`).
- Produces:
  - `Asset` = `{ kind: 'clip' | 'media'; id: string; clip?: Clip }` — `clip`이 있으면 아직 프로젝트에 없는 새 클립(`id === clip.id`). `dropPlacement`는 길이·로봇을 `asset.clip ?? p.clips[asset.id]`에서 읽는다.
  - `dropAsset`: `asset.clip`이 있으면 배치를 먼저 계산해 거부면 아무것도 바꾸지 않고 사유 반환; 아니면 `beginGesture()` → `addClip(asset.clip)` → 기존 배치 → `endGesture()`(try/finally) — 실행취소 1회.
  - `Go2BlockPanel({ actorId, blockId, onAdded? })` — `blockId`가 블록을 정함(내부 `<select>`·`actions`/`note` 대화상자 레이아웃 제거). 대상 `actorId`: 호출자가 계산.
  - `export function loadTemplate(id: string): Promise<{ fps: number; poses: Pose[] }>` (Go2BlockPanel.tsx).
- 라이브러리 탭(스펙 §5): 목록 `role=tree name=라이브러리`, 줄 `data-kind=block`, `.pp-col-kind` = `고정`(kind fixed)·`거리`(param meters)·`각도`(param degrees). 필터 적용. 블록 줄 클릭 → 아래 `Go2BlockPanel`과 `대상: <액터 이름 | 새 GO2 로봇>`. 대상 = 선택 액터가 GO2면 그것, 아니면 첫 GO2 액터, 없으면 `null`(새 로봇). 고정 블록 줄만 `draggable`: `dragstart`에서 템플릿이 캐시돼 있으면 `buildBlockClip(...)`으로 클립을 만들어 `setDragged({ kind: 'clip', id: clip.id, clip })`, 아직 로드 전이면 끌기 취소(`preventDefault`)하고 줄을 고르면 로드됨.

- [ ] **Step 1: 실패하는 단위 테스트** (`assetDrop.test.ts`, `initEditor`로 스토어를 만들고 `dropAsset` 호출)

```ts
test('a new block clip dropped on empty space makes a GO2 actor; one undo removes clip and actor', () => {
  const clip = { id: 'blk', name: 'Stretch', robot: 'go2' as const, length: 30, channels: {} }
  expect(dropAsset({ kind: 'clip', id: clip.id, clip }, null, 0)).toBeNull()
  expect(s().project.clips.blk).toBeDefined()
  expect(s().project.actors.some(a => a.robot === 'go2')).toBe(true)
  s().undo()
  expect(s().project.clips.blk).toBeUndefined()
})
test('a new block clip dropped on a locked GO2 track is rejected and adds nothing', () => {
  s().addActor('go2')
  const t = s().project.sequence.tracks.find(t => t.actorId === s().project.actors.at(-1)!.id)!
  s().setTrackFlag(t.id, 'locked', true)
  const clip = { id: 'blk', name: 'Stretch', robot: 'go2' as const, length: 30, channels: {} }
  expect(dropAsset({ kind: 'clip', id: clip.id, clip }, t.id, 0)).toBe('잠긴 트랙입니다')
  expect(s().project.clips.blk).toBeUndefined()
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/timeline/assetDrop.test.ts`.
- [ ] **Step 3: 구현** — `Asset.clip`, `dropPlacement`, `dropAsset`, `SequenceCanvas` 고스트 길이(`asset.clip?.length ?? p.clips[asset.id].length`).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 라이브러리 탭 + 제거** — `LibraryList.tsx`, `Go2BlockPanel` `blockId`, `ProjectPanel` 세 번째 탭; `Go2BlockDialog.tsx` 삭제, `App.tsx` 상태·렌더 제거, `FileMenu` `onBlocks`·항목 제거, `Inspector`에서 `Go2BlockPanel` 제거, 안 쓰게 된 `.go2-blocks`·`.insp-addrow` 등 CSS 제거.
- [ ] **Step 6: e2e 재작성** — `go2blocks.spec.ts`: (1) GO2 선택 → 라이브러리 탭 → `Move forward` 줄 → `값` 1.8 → `실제 …m (n회)` → `추가` → 트랙 끝에 `Move_…`, 이어서 `Stretch` 줄 → `값` 없음 → `추가` → 그 뒤에 `Stretch`; (2) GO2 없을 때 `추가` → GO2 액터 생성·0 s, 다음 추가는 그 뒤; (3) 빈 값 → `추가` 비활성; (4) 템플릿 404 → 오류 문구, 프로젝트 변화 없음; (5) `Stretch` 줄을 타임라인 빈 곳으로 끌기 → GO2 액터·클립 생성; (6) 모션 탭에 만든 클립 줄이 보임. `import.spec`의 메뉴 항목 수를 1 줄임. 실행: `npx playwright test e2e/go2blocks.spec.ts e2e/import.spec.ts e2e/projectPanel.spec.ts` PASS, `npx tsc -b`, `npx vitest run src/timeline src/store src/project src/model/projectFile.test.ts`.
- [ ] **Step 7: CLAUDE.md** — 구조 표 `src/project/`에 `AssetList·LibraryList·binTree` 추가, 핵심 불변식에 한 줄: 목록 패널 = 탭(`모션(CSV)|영상|라이브러리`)·제목 필터·가상 폴더(`Project.bins`, `Clip.bin`/`Media.bin`, 한 단계, 삭제 시 항목은 최상위), GO2 블록은 라이브러리 탭(메뉴·창·인스펙터 패널 없음), 스펙 경로.
- [ ] **Step 8: 커밋** — `feat(project): GO2 block library tab; remove the block dialog, menu item and inspector panel`
