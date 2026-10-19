import { create } from 'zustand'
import { csvToClip, isHeadedCsv } from './export/importCsv'
import { objectUrl, openFolder, openMediaFiles, openTextFiles, revokeUrl } from './fileio'
import { probeDuration, setMediaUrl } from './media/registry'
import { videoEnd } from './model/video'
import { getEditor, projectGeneration } from './store/store'

type Result = { head?: string; lines: string[] }
type Fps = 30 | 60

/** Import UI state: the pending fps question (answered by CsvFpsDialog) and the last result shown in the asset panel. */
export const useImportUi = create<{ ask: ((v: Fps | null) => void) | null; res: Result | null }>(() => ({ ask: null, res: null }))
export const setImportResult = (res: Result | null) => useImportUi.setState({ res })
const askFps = () => new Promise<Fps | null>(resolve => useImportUi.setState({ ask: resolve }))
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function importCsvFiles() {
  setImportResult(null)
  await importCsvTexts(await openTextFiles('.csv', true))
}

/** Files dropped on the 목록 panel: CSVs go through the same import; anything else is listed as skipped. */
export async function importDroppedFiles(list: File[]) {
  setImportResult(null)
  const csv = list.filter(f => /\.csv$/i.test(f.name)), other = list.filter(f => !csv.includes(f))
  const skipped = other.map(f => `${f.name}: CSV 파일만 끌어다 놓을 수 있습니다`)
  if (!csv.length) { setImportResult({ lines: skipped }); return }
  const files: { name: string; text: string }[] = []
  for (const f of csv) {
    try { files.push({ name: f.name, text: await f.text() }) } catch (e) { skipped.push(`${f.name}: ${why(e)}`) }
  }
  await importCsvTexts(files, skipped)
}

/** 폴더 가져오기: every CSV in a picked folder becomes a clip in a 목록 folder of the same name (not placed on the timeline). */
export async function importCsvFolder() {
  setImportResult(null)
  const dir = await openFolder()
  if (!dir) return
  const csv = dir.files.filter(f => /\.csv$/i.test(f.name))
  if (!csv.length) { setImportResult({ lines: [`${dir.name}: CSV 파일이 없습니다`] }); return }
  const files: { name: string; text: string }[] = [], skipped: string[] = []
  for (const f of csv) {
    try { files.push({ name: f.name, text: await f.text() }) } catch (e) { skipped.push(`${f.name}: ${why(e)}`) }
  }
  await importCsvTexts(files, skipped, dir.name)
}

/** bin: put the clips in a new 목록 folder of that name instead of on the robot tracks. */
async function importCsvTexts(files: { name: string; text: string }[], skipped: string[] = [], bin?: string) {
  if (!files.length) { if (skipped.length) setImportResult({ lines: skipped }); return }
  let fps: Fps = 60 // unused when every file is headed
  if (files.some(f => !isHeadedCsv(f.text))) {
    const v = await askFps()
    if (!v) return
    fps = v
  }
  const ed = getEditor()
  let n = 0
  const fails: string[] = [...skipped], ids: string[] = []
  ed.getState().beginGesture() // one undo entry for the whole batch
  for (const f of files) {
    try {
      const clip = csvToClip(f.text, ed.getState().defs, fps, f.name.replace(/\.csv$/i, ''))
      if (bin === undefined) ed.getState().importClipToActor(clip)
      else { ed.getState().addClipAsset(clip); ids.push(clip.id) }
      n++
    } catch (e) { fails.push(`${f.name}: ${why(e)}`) }
  }
  if (bin !== undefined && ids.length) ed.getState().renameBin(ed.getState().addBin('clip', ids), bin)
  ed.getState().endGesture()
  setImportResult({ head: `클립 ${n}개를 가져왔습니다`, lines: fails })
}

async function probe(f: File) {
  const url = objectUrl(f)
  try { return { url, durationF: await probeDuration(url) } } catch (e) { revokeUrl(url); throw e }
}

export async function importVideoFiles() {
  setImportResult(null)
  const files = await openMediaFiles(true)
  if (!files.length) return
  const ed = getEditor()
  const gen = projectGeneration()
  const lines: string[] = []
  const ok: { name: string; url: string; durationF: number }[] = []
  for (const f of files) { // probe everything first so the gesture below has no awaits
    try { ok.push({ name: f.name.replace(/\.[^.]*$/, ''), ...(await probe(f)) }) }
    catch (e) { lines.push(`${f.name}: ${why(e)}`) }
  }
  if (gen !== projectGeneration()) { ok.forEach(o => revokeUrl(o.url)); return } // another project was opened meanwhile
  const s = ed.getState()
  s.beginGesture() // one undo entry for the whole batch
  let placed = 0
  try {
    for (const o of ok) {
      const id = s.addMedia(o.name, o.durationF)
      setMediaUrl(id, o.url)
      // place it on V1 right away so the preview shows without a manual drag
      if (s.addVideoItem(id, videoEnd(ed.getState().project))) placed++
      else lines.push(`${o.name}: 잠긴 트랙입니다`)
    }
  } finally { s.endGesture() }
  if (placed) s.setVideoMode('split')
  setImportResult({ head: `영상 ${ok.length}개를 가져왔습니다`, lines })
}

export async function relinkMedia(m: { id: string; durationF: number }) {
  const ed = getEditor()
  setImportResult(null)
  const gen = projectGeneration()
  const [f] = await openMediaFiles(false)
  if (!f) return
  try {
    const { url, durationF } = await probe(f)
    if (gen !== projectGeneration() || !ed.getState().project.media.some(x => x.id === m.id)) { revokeUrl(url); return } // project changed or media deleted meanwhile
    setMediaUrl(m.id, url)
    if (Math.abs(durationF - m.durationF) > 1)
      setImportResult({ lines: [`길이가 다른 영상입니다(${(durationF / 60).toFixed(2)}초 ≠ ${(m.durationF / 60).toFixed(2)}초)`] })
  } catch (e) { setImportResult({ lines: [`${f.name}: ${why(e)}`] }) }
}
