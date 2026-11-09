// 사용자 블록 (수정변동사항.md §26): a piece (with its 부위 얹기 and 수정 층) or a 클립 편집 clip frozen into a clip of its own, kept in
// THIS BROWSER only (IndexedDB) — 사용자: 로컬 저장으로 충분, 사이트 데이터를 지우거나 다른 PC면 없음, 서버 저장은 서버 쪽과 합의 후.
// The 라이브러리 lists them; putting one in copies its clip into the project's 목록, so a project file never needs the browser's copy.
import { create } from 'zustand'
import { posesToClip } from './export/importCsv'
import { baseClip, editedClip, redWalks } from './model/itemClip'
import { evaluateClip, type Pose, type RobotDefs } from './model/pose'
import type { Clip, Project } from './model/types'
import type { RobotKind } from './robot/types'

export interface UserBlock { id: string; name: string; robot: RobotKind; clip: Clip; savedAt: number }
interface UserBlocksState { list: UserBlock[]; ready: boolean; local: boolean /* false = IndexedDB not available: kept until the page closes */ }
export const useUserBlocks = create<UserBlocksState>(() => ({ list: [], ready: false, local: true }))

const DB = 'motion-editor', STORE = 'userBlocks'
let db: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  return db ??= new Promise(res => {
    try {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }) }
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
      r.onblocked = () => res(null)
    } catch { res(null) }
  })
}
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const d = await openDb()
  if (!d) return null
  return new Promise(res => {
    try { const q = fn(d.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => res(q.result); q.onerror = () => res(null) } catch { res(null) }
  })
}
const sorted = (xs: UserBlock[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name, 'ko'))

/** Reads the browser's 사용자 블록 (once at start; harmless to call again). */
export async function loadUserBlocks(): Promise<void> {
  const d = await openDb()
  const all = d ? await tx<UserBlock[]>('readonly', s => s.getAll() as IDBRequest<UserBlock[]>) : null
  useUserBlocks.setState({ list: sorted(all ?? []), ready: true, local: !!d })
}
async function put(b: UserBlock) {
  await tx('readwrite', s => s.put(b))
  useUserBlocks.setState(st => ({ list: sorted([...st.list.filter(x => x.id !== b.id), b]) }))
}
export async function renameUserBlock(id: string, name: string): Promise<boolean> {
  const b = useUserBlocks.getState().list.find(x => x.id === id), n = name.trim()
  if (!b || !n) return false
  await put({ ...b, name: n, clip: { ...b.clip, name: n } })
  return true
}
export async function deleteUserBlock(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id))
  useUserBlocks.setState(st => ({ list: st.list.filter(x => x.id !== id) }))
}

const freeze = (clip: Clip, defs: RobotDefs, a: number, b: number, name: string): Clip => {
  const def = defs[clip.robot], poses: Pose[] = []
  for (let f = a; f < b; f++) poses.push(evaluateClip(clip, def, f))
  return { ...posesToClip(poses, 60, clip.robot, defs, name), id: crypto.randomUUID(), name }
}
/** The frozen clip of a piece (its frames as the piece plays them: 부위 얹기 and 수정 층 included, 기본자세 · 이음매 not), or why not. */
export function pieceBlock(p: Project, defs: RobotDefs, itemId: string, name: string): Clip | string {
  const it = p.sequence.tracks.flatMap(t => t.items).find(i => i.id === itemId)
  if (!it || !p.clips[it.refId]) return '조각을 찾을 수 없습니다'
  if (it.walk) return '걷기 조각은 사용자 블록으로 저장하지 않습니다 (걷기는 계산으로 만드는 이동)'
  if (redWalks(p, defs, [it.id]).length) return '한계 초과인 얹은 동작이 있어 저장하지 않습니다 — 먼저 고치세요'
  const clip = it.use === 'original' ? baseClip(p, defs, it.refId) : editedClip(p, defs, it)
  return clip ? freeze(clip, defs, it.trimIn, it.trimOut, name) : '클립을 찾을 수 없습니다'
}
/** The frozen clip of a 목록 clip as 클립 편집 shows it (its 클립 수정 층 included). */
export function clipBlock(p: Project, defs: RobotDefs, clipId: string, name: string): Clip | string {
  const clip = baseClip(p, defs, clipId)
  return clip ? freeze(clip, defs, 0, clip.length, name) : '클립을 찾을 수 없습니다'
}
export async function saveUserBlock(clip: Clip): Promise<UserBlock> {
  const b: UserBlock = { id: crypto.randomUUID(), name: clip.name, robot: clip.robot, clip, savedAt: Date.now() }
  await put(b)
  return b
}
/** The 목록 clip a 사용자 블록 is when put in: one already there (same robot, name and length) or a fresh copy. */
export function blockClip(p: Project, b: UserBlock): { clip: Clip; have: boolean } {
  const have = Object.values(p.clips).find(c => c.robot === b.robot && c.name === b.name && c.length === b.clip.length)
  return have ? { clip: have, have: true } : { clip: { ...structuredClone(b.clip), id: crypto.randomUUID() }, have: false }
}
