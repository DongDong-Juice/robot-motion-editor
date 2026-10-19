// GO2 block templates: headed Unitree CSVs (50fps) in public/go2-blocks/<folder>/<file>.csv, grouped by folder in the 라이브러리 tab.
// The real-robot logs (리얼데이터) keep their hand-made blocks below; every other CSV is a fixed block named from its file.
import files from 'virtual:go2-blocks'

export type Range = [number, number] // [start, end) source 50fps frames
export interface LoopSpec { head: Range; loop: Range; tail: Range }
export type Block = (
  | { id: string; label: string; kind: 'fixed' }
  | { id: 'move'; label: 'Move forward'; kind: 'loop'; param: 'meters'; spec: LoopSpec }
  | { id: 'rotate'; label: 'Rotate'; kind: 'loop'; param: 'degrees'; left: LoopSpec; right: LoopSpec }
  | { id: 'empty'; label: 'Empty'; kind: 'empty' } // no log: the GO2 rest pose held for n frames (default 30)
) & { folder?: string } // none = top level (Empty)

const REAL = '리얼데이터'
const KNOWN: Block[] = ([
  // stand still -> accelerate; loop = 1 gait cycle (35f, 0.62m, joint RMS 0.009 rad); tail decelerates to the speed minimum
  { id: 'move', label: 'Move forward', kind: 'loop', param: 'meters', spec: { head: [30, 117], loop: [117, 153], tail: [153, 171] } },
  // the spin log turns right from rest (60), reverses left at ~150, reverses again at ~245; loops = 36f, ±72°, RMS 0.013 / 0.02
  { id: 'rotate', label: 'Rotate', kind: 'loop', param: 'degrees',
    left: { head: [150, 202], loop: [202, 238], tail: [238, 245] },
    right: { head: [40, 107], loop: [107, 143], tail: [143, 150] } },
  { id: 'stretch', label: 'Stretch', kind: 'fixed' },
  { id: 'heart', label: 'ShowHeart', kind: 'fixed' },
  { id: 'hello', label: 'Hello', kind: 'fixed' },
  { id: 'sit', label: 'Sit', kind: 'fixed' },
  { id: 'standup', label: 'StandUp', kind: 'fixed' },
  { id: 'standdown', label: 'StandDown', kind: 'fixed' },
  { id: 'scrape', label: 'Scrape', kind: 'fixed' },
  { id: 'frontjump', label: 'FrontJump', kind: 'fixed' },
  { id: 'frontpounce', label: 'FrontPounce', kind: 'fixed' },
  { id: 'frontflip', label: 'FrontFlip', kind: 'fixed' },
  { id: 'backflip', label: 'BackFlip', kind: 'fixed' },
  { id: 'leftflip', label: 'LeftFlip', kind: 'fixed' },
  { id: 'rightflip', label: 'RightFlip', kind: 'fixed' },
  { id: 'empty', label: 'Empty', kind: 'empty' },
] as Block[]).map(b => b.kind === 'empty' ? b : { ...b, folder: REAL })

/** "003_기본_서기" → "기본 서기": the file number dropped, underscores as spaces. */
export const blockLabel = (file: string) => file.replace(/^\d+_/, '').replace(/_/g, ' ')
const num = (file: string) => { const m = /^(\d+)_/.exec(file); return m ? +m[1] : Infinity }
const known = new Set(KNOWN.map(b => `${b.folder}/${b.id}`))
const auto: Block[] = files.filter(f => !known.has(`${f.folder}/${f.file}`))
  .sort((a, b) => num(a.file) - num(b.file) || a.file.localeCompare(b.file))
  .map(f => ({ id: `${f.folder}/${f.file}`, label: blockLabel(f.file), kind: 'fixed', folder: f.folder }))

export const GO2_BLOCKS: Block[] = [...KNOWN, ...auto]
export const GO2_FOLDERS = [...new Set(GO2_BLOCKS.flatMap(b => b.folder ? [b.folder] : []))].sort((a, b) => a.localeCompare(b, 'ko'))
/** The CSV path under public/go2-blocks without .csv: "<folder>/<file>" (auto blocks' id already is). */
export const blockFile = (id: string) => { const b = GO2_BLOCKS.find(b => b.id === id); return b?.folder && !id.includes('/') ? `${b.folder}/${id}` : id }
export const blockUrl = (id: string) => `/go2-blocks/${blockFile(id).split('/').map(encodeURIComponent).join('/')}.csv`
