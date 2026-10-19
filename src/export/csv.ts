import { evaluate, type Pose, type RobotDefs } from '../model/evaluate'
import { evaluateClip, placePose, rebasePose } from '../model/pose'
import { baseClip, itemClip } from '../model/itemClip'
import { itemLead, itemTail, restClipFor, tailedClip } from '../model/restPose'
import type { Quat } from '../model/rootMath'
import type { Item, Project } from '../model/types'
import type { RobotDef, RobotKind } from '../robot/types'
import { validatePoses, type Warning } from './validate'

export type RootMode = 'local' | 'world'

const LABEL = { g1: 'G1', go2: 'GO2' } as const

export const itemFrameRange = (item: Item) => ({ from: item.start, to: item.start + (item.trimOut - item.trimIn) })

function findItem(p: Project, itemId: string): Item {
  for (const t of p.sequence.tracks) for (const it of t.items) if (it.id === itemId) return it
  throw new Error(`unknown item ${itemId}`)
}

// Unit-length quaternion, sign-flipped to stay on the same hemisphere as the previous row.
export function normalizedPose(src: Pose, prev?: Pose): Pose {
  const n = Math.hypot(...src.rootQuat) || 1
  let q = src.rootQuat.map(v => v / n) as Quat
  if (prev && prev.rootQuat.reduce((s, v, i) => s + v * q[i], 0) < 0) q = q.map(v => -v) as Quat
  return { rootPos: [...src.rootPos], rootQuat: q, q: [...src.q] }
}

// CSV rows added before the item's first frame (기본자세 덧붙이기: 정지 + 전이 + 관성); CSV row k is sequence frame from − restLead + k.
export const restLead = (p: Project, defs: RobotDefs, item: Item) => itemLead(p, defs, item)?.lead ?? 0
// CSV rows added after the item's last frame (끝 기본자세: 전이 + 정지).
export const restTailRows = (p: Project, defs: RobotDefs, item: Item) => itemTail(p, defs, item)?.tail ?? 0

export function samplePoses(p: Project, defs: RobotDefs, actorId: string, itemId: string, mode: RootMode): Pose[] {
  const item = findItem(p, itemId), { from, to } = itemFrameRange(item)
  const raw: Pose[] = []
  for (let f = from; f < to; f++) raw.push(evaluate(p, defs, actorId, f))
  const ld = itemLead(p, defs, item)
  if (ld && raw.length) {
    // the inserted frames come from the derived clip (정지 + 전이 at trimIn − 관성, then the original 관성 frames), placed so
    // the clip frame trimIn lands on the item's first world pose
    const clip = itemClip(p, defs, item)!, def = defs[clip.robot], a = item.trimIn - ld.inertia
    const rest = restClipFor(clip, def, a, item.trimOut, 'prepend', ld.hold, ld.blend)
    const origin = evaluateClip(clip, def, item.trimIn)
    raw.unshift(...Array.from({ length: ld.lead }, (_, k) => placePose(rebasePose(evaluateClip(rest, def, a + k), origin), raw[0])))
  }
  const tl = itemTail(p, defs, item)
  if (tl && raw.length) {
    // 끝 기본자세: the tail frames of the derived clip (전이 then 정지 after trimOut − 1), placed so that frame lands on the
    // item's last world pose
    const clip = tailedClip(p, defs, item)!, def = defs[clip.robot], end = evaluateClip(clip, def, item.trimOut - 1), last = raw[raw.length - 1]
    raw.push(...Array.from({ length: tl.tail }, (_, k) => placePose(rebasePose(evaluateClip(clip, def, item.trimOut + k), end), last)))
  }
  const out: Pose[] = []
  for (const r of raw) out.push(normalizedPose(r, out[out.length - 1]))
  // Pre-multiplying by a constant quat keeps the sign continuity established above.
  if (mode === 'local' && out.length) return out.map(o => rebasePose(o, out[0]))
  return out
}

const fmt = (v: number) => {
  const s = v.toFixed(6)
  return s === '-0.000000' ? '0.000000' : s
}

export const CSV_FPS = 60
export const ROBOT_TYPE: Record<RobotKind, number> = { g1: 0, go2: 1 }
export const HEAD_FIXED = ['frequency(fps)', 'RobotType', 'DOF Number', 'time(ms)', 'position X(m)', 'position Y(m)', 'position Z(m)',
  'quaternion X', 'quaternion Y', 'quaternion Z', 'quaternion W']

// Unitree RL motion CSV: header + one row per frame, every line ends with a comma; lines joined by newlines.
export const posesToCsv = (poses: Pose[], def: RobotDef): string =>
  [[...HEAD_FIXED, ...def.joints.map(j => j.name)].join(',') + ',',
    ...poses.map((p, i) => [CSV_FPS, ROBOT_TYPE[def.kind], def.joints.length, Math.round(i * 1000 / CSV_FPS),
      ...[...p.rootPos, ...p.rootQuat, ...p.q].map(fmt)].join(',') + ',')].join('\n') // no newline after the last line, like the reference files

export function csvFileName(p: Project, actorId: string, itemId: string, taken: Set<string>, project = 'Untitled'): string {
  const actor = p.actors.find(a => a.id === actorId)
  if (!actor) throw new Error(`unknown actor ${actorId}`)
  const item = findItem(p, itemId)
  const clip = p.clips[item.refId]
  const shared = p.actors.filter(a => a.robot === actor.robot).length > 1
  const clean = (s: string) => s.replace(/[/\\:*?"<>|#\s]/g, '_')
  // Cut pieces share one clip: number them by start (1-based) on this actor's tracks so each piece keeps its own name.
  // GO2: every piece is numbered by start (user: library blocks too), as pieceName shows it.
  const pieces = p.sequence.tracks.filter(t => t.actorId === actorId).flatMap(t => t.items)
    .filter(it => actor.robot === 'go2' || it.refId === item.refId).sort((a, b) => a.start - b.start)
  const base = pieces.length > 1 || actor.robot === 'go2' ? `${clean(project)}-${LABEL[actor.robot]}-${pieces.indexOf(item) + 1}` // same as the piece's display name
    : `${clean(shared ? actor.name : LABEL[actor.robot])}_${clean(clip?.name ?? 'clip')}`
  let name = `${base}.csv`
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}.csv`
  taken.add(name)
  return name
}

// One item's CSV: file name, text and validation warnings (the same rows for the multi export and the single export). Local root
// (first frame at the origin facing +x): the 월드 option was removed (user: unused).
export function exportItemCsv(p: Project, defs: RobotDefs, actorId: string, itemId: string, taken = new Set<string>(), project?: string):
  { name: string; text: string; warnings: Warning[] } {
  const robot = p.actors.find(a => a.id === actorId)?.robot
  if (!robot) throw new Error(`unknown actor ${actorId}`)
  const poses = samplePoses(p, defs, actorId, itemId, 'local')
  return { name: csvFileName(p, actorId, itemId, taken, project), text: posesToCsv(poses, defs[robot]), warnings: validatePoses(poses, defs[robot], itemFrameRange(findItem(p, itemId)).from - restLead(p, defs, findItem(p, itemId))) }
}

/** 클립 편집 모드 `CSV 저장`: the clip as an asset (baseClip = original + 클립 수정 층), every frame, local root (first frame at the
 * origin facing +x), no lead-in or tail. Name `<G1|GO2>_<clip>.csv`. The warnings use clip frames. */
export function exportClipCsv(p: Project, defs: RobotDefs, clipId: string): { name: string; text: string; warnings: Warning[] } {
  const clip = baseClip(p, defs, clipId)
  if (!clip) throw new Error(`unknown clip ${clipId}`)
  const def = defs[clip.robot], out: Pose[] = []
  for (let f = 0; f < clip.length; f++) out.push(normalizedPose(evaluateClip(clip, def, f), out[out.length - 1]))
  const poses = out.length ? out.map(o => rebasePose(o, out[0])) : out
  const name = `${LABEL[clip.robot]}_${clip.name.replace(/[/\:*?"<>|#\s]/g, '_')}.csv`
  return { name, text: posesToCsv(poses, def), warnings: validatePoses(poses, def, 0) }
}
