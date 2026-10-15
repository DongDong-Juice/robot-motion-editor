import { useEffect, useRef, useState } from 'react'
import { importCsvFiles, importVideoFiles } from './importActions'
import { newProjectFile, openProject, saveProject } from './projectActions'

type Item = { label: string; hint?: string; tip: string; run: () => void } // tip: hover help

export default function FileMenu({ onExport, onPhysics }: { onExport: () => void; onPhysics: () => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null) // null = closed
  const trig = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const first = useRef(false) // focus the first item once the menu has rendered
  const groups: Item[][] = [
    [{ label: '새 프로젝트', tip: '빈 프로젝트를 새로 시작합니다', run: newProjectFile },
      { label: '열기', hint: 'Ctrl+O', tip: '저장해 둔 프로젝트 파일(.motion.json)을 엽니다. 지금 작업은 닫히고 그 프로젝트의 로봇·클립·타임라인·기본자세 설정이 그대로 돌아옵니다', run: openProject },
      { label: '저장', hint: 'Ctrl+S', tip: '프로젝트 파일(.motion.json)로 저장합니다. 나중에 열기로 이어서 작업할 수 있습니다', run: () => saveProject() },
      { label: '다른 이름으로 저장', hint: 'Ctrl+Shift+S', tip: '프로젝트를 새 파일 이름으로 저장합니다', run: () => saveProject(true) }],
    [{ label: 'CSV 가져오기', tip: '모션 CSV(RL 학습용 형식)를 지금 프로젝트에 클립으로 추가합니다. 지금 작업은 그대로 두고 로봇 트랙에 이어 붙입니다', run: importCsvFiles },
      { label: '영상 가져오기', tip: '참조 영상을 V1 트랙에 추가합니다(프로젝트에는 저장되지 않아 다시 열면 재연결 필요)', run: importVideoFiles }],
    [{ label: '물리 설정…', tip: '물리 검증의 kp/kd와 경고 기준을 바꿉니다', run: onPhysics }],
    [{ label: '내보내기', tip: '타임라인의 조각들을 RL 학습용 CSV로 내보냅니다(조각마다 파일 하나)', run: onExport }],
  ]
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
  const open = (focusFirst: boolean) => {
    const r = trig.current!.getBoundingClientRect()
    first.current = focusFirst
    setPos({ left: r.left, top: r.bottom + 2 })
  }
  const close = () => { setPos(null); trig.current?.focus() }

  useEffect(() => { if (pos && first.current) { first.current = false; items()[0]?.focus() } }, [pos])
  useEffect(() => {
    if (!pos) return
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !trig.current?.contains(e.target as Node)) setPos(null) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [pos])

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') setPos(null)
    if (!['Enter', 'ArrowDown'].includes(e.key)) return // Space stays the global play/pause
    e.preventDefault(); e.stopPropagation() // not a global Enter shortcut
    open(true)
  }
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items(), i = list.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus() }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close() // focus lands on the trigger; the default Tab then moves on from there
  }

  return (
    <>
      <button ref={trig} aria-haspopup="menu" aria-expanded={!!pos} onClick={() => (pos ? setPos(null) : open(false))} onKeyDown={onTriggerKey}>메뉴</button>
      {pos && (
        <div ref={menu} role="menu" aria-label="메뉴" className="mb-menu" style={pos} onKeyDown={onMenuKey}>
          {groups.map((g, gi) => (
            <div key={gi} role="group">
              {gi > 0 && <div role="separator" className="mb-sep" />}
              {g.map(it => (
                <button key={it.label} role="menuitem" tabIndex={-1} aria-keyshortcuts={it.hint} title={it.tip}
                  onClick={() => { close(); it.run() }}>
                  {it.label}{it.hint && <span className="mb-hint" aria-hidden="true">{it.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
