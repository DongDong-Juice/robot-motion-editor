// exportItemCsv text -> rows (1 header line, trailing comma ignored). root = cols 4..10, joints = 11..
export function csvRows(text: string): Float64Array[] {
  return text.split('\n').slice(1).filter(l => l.trim()).map(l => Float64Array.from(l.replace(/,\s*$/, '').split(','), Number))
}
