import type { RobotDefs } from '../model/evaluate'
import type { Item, Project } from '../model/types'
import type { ItemPhys } from '../physics/physicsStore'
import { stale } from '../physics/runItem'
import { itemFrameRange } from './csv'
import type { Warning } from './validate'

/** No result yet, or the stored one is stale. An errored item (미지원, engine failure) is not retried. */
export const needsRun = (p: Project, defs: RobotDefs, actorId: string, itemId: string, st: ItemPhys | undefined) =>
  !st || (st.status === 'done' && stale(p, defs, actorId, itemId))

/** Segment frames are CSV rows; warnings use sequence frames (item start + row), like validatePoses. */
export const physicsWarnings = (item: Item, st: ItemPhys | undefined): Warning[] =>
  st?.status !== 'done' || !st.metrics ? [] : st.metrics.segments.map(s => {
    const a = itemFrameRange(item).from
    return { kind: 'physicsAssist', frame: a + s.from, channel: 'root',
      message: `물리 보조력 · f${a + s.from}–${a + s.to} · 최대 ${Math.round(s.maxPct)}% 체중` }
  })
