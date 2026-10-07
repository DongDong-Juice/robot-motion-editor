import { openTextFiles, saveTextFile, type SaveHandle } from './fileio'
import { parseProject, serializeProject } from './model/projectFile'
import { getEditor } from './store/store'

let handle: SaveHandle | null = null // not in zustand: opaque, never rendered
const listeners = new Set<(m: string) => void>()
export const onMessage = (fn: (m: string) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const say = (m: string) => listeners.forEach(f => f(m))
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

const proceed = () => !getEditor().getState().dirty || confirm('저장하지 않은 변경 사항이 있습니다. 계속할까요?')

export function newProjectFile() {
  if (!proceed()) return
  handle = null
  getEditor().getState().newProjectFile()
}

export async function openProject() {
  if (!proceed()) return
  try {
    const [f] = await openTextFiles('.json', false)
    if (!f) return
    const s = getEditor().getState()
    s.loadProject(parseProject(f.text, s.defs), f.name)
    handle = null
    say('열었습니다')
  } catch (e) { say(`열기 실패: ${why(e)}`) }
}

let saving = false
export async function saveProject(as = false) {
  if (saving) return
  saving = true
  const s = getEditor().getState(), snap = s.project
  try {
    const text = serializeProject(snap)
    parseProject(text, s.defs) // never write a file that would not reopen
    const r = await saveTextFile(text, s.fileName ?? 'project.motion.json', as ? null : handle)
    if (!r) return
    handle = r.handle
    if (getEditor().getState().project === snap) getEditor().getState().markSaved(r.name)
    else getEditor().setState({ fileName: r.name })
    say('저장했습니다')
  } catch (e) { say(`저장 실패: ${why(e)}`) }
  finally { saving = false }
}
