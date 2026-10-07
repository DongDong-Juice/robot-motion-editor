import type { RobotKind } from '../robot/types'
import type { Actor, Clip, Project, Track } from './types'

const COLOR: Record<RobotKind, string> = { g1: '#58B4D1', go2: '#C9D65A' }
const LABEL: Record<RobotKind, string> = { g1: 'G1', go2: 'GO2' }
const LENGTH = 120

function makeActor(p: Project | null, robot: RobotKind, x: number): { actor: Actor; clip: Clip; track: Track } {
  const n = (p?.actors.filter(a => a.robot === robot).length ?? 0) + 1
  const actor: Actor = {
    id: crypto.randomUUID(), name: `${LABEL[robot]} #${n}`, robot, color: COLOR[robot],
    placement: { x, y: 0, yaw: 0 },
  }
  const clip: Clip = { id: crypto.randomUUID(), name: 'clip_01', robot, length: LENGTH, channels: {} }
  const track: Track = {
    id: crypto.randomUUID(), kind: 'motion', actorId: actor.id, hidden: false, locked: false,
    items: [{ id: crypto.randomUUID(), refId: clip.id, start: 0, trimIn: 0, trimOut: LENGTH }],
  }
  return { actor, clip, track }
}

export function addActor(p: Project, robot: RobotKind): Project {
  const { actor, clip, track } = makeActor(p, robot, 1.5 * p.actors.length)
  return {
    ...p,
    actors: [...p.actors, actor],
    clips: { ...p.clips, [clip.id]: clip },
    sequence: { ...p.sequence, tracks: [...p.sequence.tracks, track] },
  }
}

export function newProject(): Project {
  const g = makeActor(null, 'g1', 0), d = makeActor(null, 'go2', 1.5)
  return {
    version: 1, fps: 60,
    actors: [g.actor, d.actor],
    clips: { [g.clip.id]: g.clip, [d.clip.id]: d.clip },
    media: [],
    sequence: { tracks: [g.track, d.track], markers: [], inF: null, outF: null },
  }
}
