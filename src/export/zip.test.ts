import { expect, test } from 'vitest'
import { unzip } from '../../e2e/unzip'
import { zip } from './zip'

test('zip round-trips UTF-8 names and contents with correct CRC', () => {
  const files = [{ name: 'G1_걷기.csv', text: '123456789' }, { name: 'GO2_a.csv', text: 'a,b,\n1,2,' }]
  const z = zip(files)
  const back = unzip(z)
  expect(back.map(f => ({ name: f.name, text: f.text }))).toEqual(files)
  expect(back[0].crc).toBe(0xCBF43926) // CRC-32 check value of "123456789"
  const v = new DataView(z.buffer)
  expect(v.getUint32(z.length - 22, true)).toBe(0x06054B50)
  expect(v.getUint16(z.length - 12, true)).toBe(2)
})
