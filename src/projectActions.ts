import { hubRead, hubWrite, openTextFiles, saveTextFile, type SaveHandle } from './fileio'
import { clearMedia } from './media/registry'
import { parseProject, projectFileName, serializeProject } from './model/projectFile'
import { getEditor } from './store/store'
import { emptyProject } from './model/defaults'

let handle: SaveHandle | null = null // not in zustand: opaque, never rendered
let hub: { name: string; mtime: number } | null = null // opened from / created on the project hub: Ctrl+S writes there
const listeners = new Set<(m: string) => void>()
export const onMessage = (fn: (m: string) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const say = (m: string) => listeners.forEach(f => f(m))
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

const proceed = () => !getEditor().getState().dirty || confirm('저장하지 않은 변경 사항이 있습니다. 계속할까요?')

// 프로젝트 팝업 (StartScreen): 메뉴 새 프로젝트·열기·Ctrl+O. adding = open with the new-project row.
const hubListeners = new Set<(adding: boolean) => void>()
export const onShowHub = (fn: (adding: boolean) => void) => { hubListeners.add(fn); return () => { hubListeners.delete(fn) } }
export function showProjectHub(adding = false) {
  if (proceed()) hubListeners.forEach(f => f(adding)) // the popup's actions replace the project without asking again
}

export function newProjectFile() {
  handle = null; hub = null
  clearMedia()
  getEditor().getState().newProjectFile()
}

/** '' when the project name can be a file name, else why not. */
export const badTitle = (t: string) => !t.trim() ? '이름을 입력하세요' : /[/\\:*?"<>|]|\.\./.test(t) ? '이름에 / \\ : * ? " < > | 는 쓸 수 없습니다' : ''

export async function openHubProject(name: string): Promise<boolean> {
  try {
    const { text, mtime } = await hubRead(name)
    const s = getEditor().getState()
    const as = projectFileName(name) // an old .motion.json: Ctrl+S writes <title>.mproj beside it
    s.loadProject(parseProject(text, s.defs), as)
    handle = null; hub = { name: as, mtime }
    clearMedia()
    say('열었습니다')
    return true
  } catch (e) { say(`열기 실패: ${why(e)}`); return false }
}

/** New empty project saved on the hub as "<title>.mproj"; 'exists' when that name is taken. */
export async function newHubProject(title: string): Promise<boolean | 'exists'> {
  const name = projectFileName(title.trim())
  try {
    const r = await hubWrite(name, serializeProject(emptyProject()), { create: true })
    if ('error' in r) return 'exists'
    newProjectFile()
    getEditor().getState().markSaved(name)
    hub = { name, mtime: r.mtime }
    return true
  } catch (e) { say(`만들기 실패: ${why(e)}`); return false }
}

/** No hub server: new empty project that only has a name until the first 저장 (saved to this PC). */
export function newLocalProject(title: string) {
  newProjectFile()
  getEditor().getState().markSaved(projectFileName(title.trim()))
}

export async function openProject(): Promise<boolean> {
  try {
    const [f] = await openTextFiles('.mproj,.json', false)
    if (!f) return false
    const s = getEditor().getState()
    s.loadProject(parseProject(f.text, s.defs), projectFileName(f.name)) // an old .motion.json saves as .mproj (the old file stays)
    handle = null; hub = null
    clearMedia()
    say('열었습니다')
    return true
  } catch (e) { say(`열기 실패: ${why(e)}`); return false }
}

let saving = false
export async function saveProject(as = false) {
  if (saving) return
  saving = true
  const s = getEditor().getState(), snap = s.project
  try {
    const text = serializeProject(snap)
    parseProject(text, s.defs) // never write a file that would not reopen
    if (hub && !as) {
      let w = await hubWrite(hub.name, text, { base: hub.mtime })
      if ('error' in w) {
        if (!confirm('다른 사람이 이 프로젝트를 서버에 저장했습니다. 덮어쓸까요?')) return
        w = await hubWrite(hub.name, text)
      }
      if ('error' in w) throw new Error(w.error)
      hub.mtime = w.mtime
      if (getEditor().getState().project === snap) getEditor().getState().markSaved(hub.name)
      say('서버에 저장했습니다')
      return
    }
    const r = await saveTextFile(text, s.fileName ?? projectFileName('project'), as ? null : handle)
    if (!r) return
    handle = r.handle; hub = null
    if (getEditor().getState().project === snap) getEditor().getState().markSaved(r.name)
    else getEditor().setState({ fileName: r.name })
    say('저장했습니다')
  } catch (e) { say(`저장 실패: ${why(e)}`) }
  finally { saving = false }
}
