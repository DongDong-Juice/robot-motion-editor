import type { RobotDefs } from './evaluate'
import { validTrack } from './sequence'
import type { Media, Project } from './types'
import { validVideoTrack } from './video'

export const serializeProject = (p: Project): string => JSON.stringify(p, null, 1)

class Bad extends Error {}
const fail = (path: string, what = '형식이 올바르지 않습니다'): never => { throw new Bad(`${path} ${what}`) }
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const int = (v: unknown) => Number.isInteger(v)
const str = (v: unknown) => typeof v === 'string'

// Returns the project (extra fields kept) or throws Error with a Korean message naming the first problem.
export function parseProject(text: string, defs: RobotDefs): Project {
  let p: any
  try { p = JSON.parse(text) } catch { throw new Error('프로젝트 파일을 읽을 수 없습니다') }
  if (!isObj(p)) throw new Error('프로젝트 파일을 읽을 수 없습니다')
  try {
    if (p.version !== 1) throw new Bad(`지원하지 않는 버전입니다: ${p.version}`)
    if (p.fps !== 60) throw new Bad(`fps는 60이어야 합니다: ${p.fps}`)
    const robot = (v: unknown, path: string) => { if (!str(v) || !Object.hasOwn(defs, v)) fail(path, '로봇 종류를 알 수 없습니다') }
    const tan = (t: any, path: string) => { if (!isObj(t) || !num(t.df) || !num(t.dv)) fail(path) }

    if (!Array.isArray(p.actors)) fail('actors')
    const actorIds = new Set<string>(), actorRobot: Record<string, string> = {}, itemIds = new Set<string>(), motionActors = new Set<string>()
    p.actors.forEach((a: any, i: number) => {
      const at = `actors.${i}`
      if (!isObj(a) || !str(a.id) || !str(a.name) || !str(a.color)) fail(at)
      robot(a.robot, `${at}.robot`)
      if (!isObj(a.placement) || !num(a.placement.x) || !num(a.placement.y) || !num(a.placement.yaw)) fail(`${at}.placement`)
      if (actorIds.has(a.id)) fail(`${at}.id`, '중복된 ID입니다')
      actorIds.add(a.id); actorRobot[a.id] = a.robot
    })

    if (!isObj(p.clips)) fail('clips')
    for (const [id, c] of Object.entries<any>(p.clips)) {
      const at = `clips.${id}`
      if (!isObj(c) || c.id !== id || !str(c.name)) fail(at)
      robot(c.robot, `${at}.robot`)
      if (!int(c.length) || c.length < 1) fail(`${at}.length`)
      if (!isObj(c.channels)) fail(`${at}.channels`)
      for (const [ch, cv] of Object.entries<any>(c.channels)) {
        if (!isObj(cv) || !Array.isArray(cv.keys)) fail(`${at}.channels.${ch}`)
        cv.keys.forEach((k: any, i: number) => {
          const kt = `${at}.channels.${ch}.keys.${i}`
          if (!isObj(k) || !int(k.f) || !num(k.v)) fail(kt)
          if (i > 0 && k.f <= cv.keys[i - 1].f) fail(`${kt}.f`, '순서가 올바르지 않습니다')
          if (!['linear', 'bezier', 'hold'].includes(k.interp)) fail(`${kt}.interp`)
          tan(k.inTan, `${kt}.inTan`); tan(k.outTan, `${kt}.outTan`)
        })
      }
    }

    if (!Array.isArray(p.media)) fail('media')
    const media: Record<string, Media> = Object.create(null) // no prototype: an id of "__proto__" is just a key
    p.media.forEach((m: any, i: number) => {
      const at = `media.${i}`
      if (!isObj(m) || !str(m.id) || !str(m.name)) fail(at)
      if (!int(m.durationF) || m.durationF < 1) fail(`${at}.durationF`)
      if (Object.hasOwn(media, m.id)) fail(`${at}.id`, '중복된 ID입니다')
      media[m.id] = m
    })
    let videoTracks = 0
    const s = p.sequence
    if (!isObj(s)) fail('sequence')
    if (!Array.isArray(s.tracks)) fail('sequence.tracks')
    if (!Array.isArray(s.markers) || s.markers.some((m: any) => !isObj(m) || !num(m.f) || !str(m.name))) fail('sequence.markers')
    for (const k of ['inF', 'outF']) if (s[k] !== null && !int(s[k])) fail(`sequence.${k}`)
    s.tracks.forEach((t: any, i: number) => {
      const at = `sequence.tracks.${i}`
      if (!isObj(t) || !str(t.id) || !['video', 'motion'].includes(t.kind) || typeof t.hidden !== 'boolean' || typeof t.locked !== 'boolean') fail(at)
      if (t.kind === 'video') {
        if (++videoTracks > 1) fail(at, '영상 트랙은 하나만 둘 수 있습니다')
        if (t.actorId !== undefined) fail(`${at}.actorId`, '영상 트랙에는 액터가 없어야 합니다')
      }
      if (t.kind === 'motion' && !actorIds.has(t.actorId)) fail(`${at}.actorId`, '액터가 없습니다')
      if (t.kind === 'motion') { if (motionActors.has(t.actorId)) fail(`${at}.actorId`, '액터의 트랙이 중복됩니다'); motionActors.add(t.actorId) }
      if (!Array.isArray(t.items)) fail(`${at}.items`)
      t.items.forEach((it: any, j: number) => {
        const it_ = `${at}.items.${j}`
        if (!isObj(it) || !str(it.id) || !int(it.start) || !int(it.trimIn) || !int(it.trimOut)) fail(it_)
        if (itemIds.has(it.id)) fail(`${it_}.id`, '중복된 ID입니다')
        itemIds.add(it.id)
        if (t.kind === 'video') {
          if (!str(it.refId) || !Object.hasOwn(media, it.refId)) fail(`${it_}.refId`, '영상이 없습니다')
          if (it.trimOut > media[it.refId].durationF) fail(`${it_}.trimOut`, '영상 길이를 넘습니다')
          return
        }
        if (!str(it.refId) || !Object.hasOwn(p.clips, it.refId)) fail(`${it_}.refId`, '클립이 없습니다')
        if (t.kind === 'motion' && p.clips[it.refId].robot !== actorRobot[t.actorId]) fail(`${it_}.refId`, '클립의 로봇이 액터와 다릅니다')
        if (it.trimOut > p.clips[it.refId].length) fail(`${it_}.trimOut`, '클립 길이를 넘습니다')
      })
      if (!(t.kind === 'video' ? validVideoTrack(t.items, media) : validTrack(t.items))) fail(at, '항목 배치가 올바르지 않습니다 (겹침 또는 범위)')
    })
  } catch (e) {
    throw e instanceof Bad ? new Error(e.message) : e
  }
  return p as Project
}
