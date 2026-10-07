import { createStore, useStore, type StoreApi } from 'zustand'
import { evalCurve, makeKey } from '../model/curve'
import { addActor as addActorTo, newProject } from '../model/defaults'
import { evaluateClip, type RobotDefs } from '../model/evaluate'
import type { Actor, Clip, Interp, Project, Tan } from '../model/types'
import type { RobotKind } from '../robot/types'

export type KeyRef = { channel: string; f: number }
export interface Selection { actorId: string | null; channel: string | null; keys: KeyRef[] }
export interface EditorState {
  defs: RobotDefs; project: Project; frame: number; playing: boolean; autoKey: boolean
  view: 'tracks' | 'graph'; sel: Selection
  setFrame(f: number): void; setPlaying(b: boolean): void; toggleAutoKey(): void; setView(v: 'tracks' | 'graph'): void
  select(actorId: string | null, channel?: string | null): void; selectKeys(keys: KeyRef[], additive: boolean): void
  setValue(actorId: string, channel: string, v: number): void
  setKey(clipId: string, channel: string, f: number, v: number): void
  deleteKeys(clipId: string, keys: KeyRef[]): void
  moveKeys(clipId: string, keys: KeyRef[], df: number): void
  setInterp(clipId: string, keys: KeyRef[], interp: Interp): void
  setTangent(clipId: string, channel: string, f: number, side: 'in' | 'out', t: Tan, linked: boolean): void
  keyGroup(actorId: string, group: string): void
  setPlacement(actorId: string, pl: Partial<Actor['placement']>): void
  addActor(robot: RobotKind): void
  beginGesture(): void; endGesture(): void
  undo(): void; redo(): void
}

const MAX_UNDO = 200
const ROOT = ['root.x', 'root.y', 'root.z', 'root.roll', 'root.pitch', 'root.yaw']

export function clipFrameAt(p: Project, actorId: string, frame: number): { clipId: string; f: number } {
  const item = p.sequence.tracks.find(t => t.kind === 'motion' && t.actorId === actorId)?.items[0]
  if (!item) throw new Error(`actor ${actorId} has no clip`)
  const f = Math.min(Math.max(frame - item.start + item.trimIn, item.trimIn), item.trimOut - 1)
  return { clipId: item.refId, f }
}

export function createEditorStore(defs: RobotDefs): StoreApi<EditorState> {
  return createStore<EditorState>((set, get) => {
    let undoS: Project[] = [], redoS: Project[] = []
    let gesture: Project | null = null // project at gesture start; edits inside it share one undo entry

    // One user action = one undo entry: mutate a clone, push the old project.
    const commit = (next: Project) => {
      if (!gesture) { undoS = [...undoS, get().project].slice(-MAX_UNDO); redoS = [] }
      set({ project: next })
    }
    const edit = (fn: (p: Project) => void) => {
      const next = structuredClone(get().project)
      fn(next)
      commit(next)
    }

    const putKey = (clip: Clip, channel: string, f: number, v: number) => {
      const j = defs[clip.robot].joints.find(j => j.name === channel)
      if (j) v = Math.min(Math.max(v, j.lower), j.upper)
      f = Math.min(Math.max(Math.round(f), 0), clip.length - 1)
      const keys = (clip.channels[channel] ??= { keys: [] }).keys
      const k = keys.find(k => k.f === f)
      if (k) k.v = v
      else { keys.push(makeKey(f, v)); keys.sort((a, b) => a.f - b.f) }
    }
    const findKey = (clip: Clip, r: KeyRef) => clip.channels[r.channel]?.keys.find(k => k.f === r.f)

    return {
      defs, project: newProject(), frame: 0, playing: false, autoKey: false, view: 'tracks',
      sel: { actorId: null, channel: null, keys: [] },
      setFrame: frame => set({ frame }),
      setPlaying: playing => set({ playing }),
      toggleAutoKey: () => set(s => ({ autoKey: !s.autoKey })),
      setView: view => set({ view }),
      select: (actorId, channel = null) => set({ sel: { actorId, channel, keys: [] } }),
      selectKeys: (keys, additive) => set(s => {
        const base = additive ? s.sel.keys : []
        const add = keys.filter((k, i) =>
          !base.some(b => b.channel === k.channel && b.f === k.f) &&
          keys.findIndex(o => o.channel === k.channel && o.f === k.f) === i)
        return { sel: { ...s.sel, keys: [...base, ...add] } }
      }),
      setValue: (actorId, channel, v) => {
        if (!get().autoKey) return
        const { clipId, f } = clipFrameAt(get().project, actorId, get().frame)
        get().setKey(clipId, channel, f, v)
      },
      setKey: (clipId, channel, f, v) => edit(p => putKey(p.clips[clipId], channel, f, v)),
      deleteKeys: (clipId, keys) => edit(p => {
        const clip = p.clips[clipId]
        for (const r of keys) {
          const c = clip.channels[r.channel]
          if (c) c.keys = c.keys.filter(k => k.f !== r.f)
        }
        set(s => ({ sel: { ...s.sel, keys: s.sel.keys.filter(k => !keys.some(r => r.channel === k.channel && r.f === k.f)) } }))
      }),
      moveKeys: (clipId, keys, df) => {
        const moved: KeyRef[] = []
        edit(p => {
          const clip = p.clips[clipId]
          for (const channel of new Set(keys.map(k => k.channel))) {
            const c = clip.channels[channel]
            if (!c) continue
            const from = new Set(keys.filter(k => k.channel === channel).map(k => k.f))
            const sel = c.keys.filter(k => from.has(k.f))
            if (!sel.length) continue
            // clamp the shared delta so the group keeps its shape (no merged keys)
            const d = Math.min(Math.max(Math.round(df), -sel[0].f), clip.length - 1 - sel[sel.length - 1].f)
            const mv = sel.map(k => ({ ...k, f: k.f + d }))
            const dest = new Set(mv.map(k => k.f))
            c.keys = [...c.keys.filter(k => !from.has(k.f) && !dest.has(k.f)), ...mv].sort((a, b) => a.f - b.f)
            moved.push(...mv.map(k => ({ channel, f: k.f })))
          }
        })
        set(s => ({ sel: { ...s.sel, keys: moved } }))
      },
      setInterp: (clipId, keys, interp) => edit(p => {
        for (const r of keys) {
          const k = findKey(p.clips[clipId], r)
          if (!k) continue
          k.interp = interp
          if (interp === 'bezier') { k.inTan.dv = 0; k.outTan.dv = 0 }
        }
      }),
      setTangent: (clipId, channel, f, side, t, linked) => edit(p => {
        const k = findKey(p.clips[clipId], { channel, f })
        if (!k) return
        const [mine, other] = side === 'out' ? [k.outTan, k.inTan] : [k.inTan, k.outTan]
        mine.df = t.df; mine.dv = t.dv
        if (linked && t.df !== 0) other.dv = (t.dv / t.df) * other.df
      }),
      keyGroup: (actorId, group) => {
        const actor = get().project.actors.find(a => a.id === actorId)!
        const def = defs[actor.robot]
        const { clipId, f } = clipFrameAt(get().project, actorId, get().frame)
        const names = group === '루트' ? ROOT : def.groups.find(g => g.name === group)?.joints
        if (!names) throw new Error(`unknown group ${group}`)
        edit(p => {
          const clip = p.clips[clipId]
          const pose = evaluateClip(clip, def, f)
          for (const n of names) {
            const v = ROOT.includes(n)
              ? evalCurve(clip.channels[n] ?? { keys: [] }, f, n === 'root.z' ? def.standingHeight : 0)
              : pose.q[def.joints.findIndex(j => j.name === n)]
            putKey(clip, n, f, v)
          }
        })
      },
      setPlacement: (actorId, pl) => edit(p => {
        Object.assign(p.actors.find(a => a.id === actorId)!.placement, pl)
      }),
      addActor: robot => commit(addActorTo(structuredClone(get().project), robot)),
      beginGesture: () => {
        if (gesture) return
        gesture = get().project
        undoS = [...undoS, gesture].slice(-MAX_UNDO); redoS = []
      },
      endGesture: () => {
        if (gesture && get().project === gesture) undoS = undoS.slice(0, -1) // nothing changed
        gesture = null
      },
      undo: () => {
        const prev = undoS.at(-1)
        if (!prev) return
        undoS = undoS.slice(0, -1); redoS = [...redoS, get().project]
        set(s => ({ project: prev, sel: { ...s.sel, keys: [] } }))
      },
      redo: () => {
        const next = redoS.at(-1)
        if (!next) return
        redoS = redoS.slice(0, -1); undoS = [...undoS, get().project]
        set(s => ({ project: next, sel: { ...s.sel, keys: [] } }))
      },
    }
  })
}

let editor: StoreApi<EditorState> | null = null
export function initEditor(defs: RobotDefs): StoreApi<EditorState> {
  return (editor = createEditorStore(defs))
}
export function getEditor(): StoreApi<EditorState> {
  if (!editor) throw new Error('editor not initialized')
  return editor
}
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(getEditor(), selector)
}
