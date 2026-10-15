import type { RobotDefs } from '../model/evaluate'
import type { Item, Project } from '../model/types'
import type { ItemPhys } from '../physics/physicsStore'
import { csvKey, stale } from '../physics/runItem'
import { itemFrameRange, restLead } from './csv'
import type { Warning } from './validate'

/** No result yet, or the stored one is stale. 미지원 is never retried; other errors only once the input (key) changed. */
export const needsRun = (p: Project, defs: RobotDefs, actorId: string, itemId: string, st: ItemPhys | undefined) =>
  !st || (st.status === 'done' && stale(p, defs, actorId, itemId))
  || (st.status === 'error' && st.message !== '미지원' && st.key !== csvKey(p, defs, actorId, itemId).key)

/** Segment frames are CSV rows; warnings use sequence frames (item start − restLead + row), like validatePoses.
 * A span inside the prepended rest frames jumps to the item start. */
export const physicsWarnings = (p: Project, defs: RobotDefs, item: Item, st: ItemPhys | undefined): Warning[] =>
  st?.status !== 'done' || !st.metrics ? [] : st.metrics.segments.map(s => {
    const from = itemFrameRange(item).from, a = from - restLead(p, defs, item)
    return { kind: 'physicsAssist', frame: Math.max(from, a + s.from), channel: 'root',
      message: `물리 보조력 · f${a + s.from}–${a + s.to} · 최대 ${Math.round(s.maxPct)}% 체중` }
  })
