import { saveCsvFile } from '../fileio'
import { exportItemCsv } from './csv'
import type { Project } from '../model/types'
import type { RobotDefs } from '../model/evaluate'

// Single-item export (root mode 로컬). Returns the message to show, or null when the user cancelled.
export async function exportOne(project: Project, defs: RobotDefs, actorId: string, itemId: string,
  ask: (m: string) => boolean = m => window.confirm(m)): Promise<string | null> {
  try {
    const { name, text, warnings } = exportItemCsv(project, defs, actorId, itemId, 'local')
    if (warnings.length && !ask(`경고 ${warnings.length}개가 있습니다 (관절 한계·속도·루트). 그래도 내보낼까요?`)) return null
    return (await saveCsvFile(name, text)) ? `${name} 을(를) 내보냈습니다` : null
  } catch (e) { return `내보내기 실패: ${e instanceof Error ? e.message : e}` }
}
