// Minimal ZIP writer (stored, no compression; UTF-8 names). ponytail: no deflate — add CompressionStream('deflate-raw') if archive size matters.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (b: Uint8Array) => {
  let c = ~0
  for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8)
  return ~c >>> 0
}

export function zip(files: { name: string; text: string }[], now = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts: Uint8Array[] = [], central: Uint8Array[] = []
  let off = 0
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data)
    // Shared fields of the local (30 B) and central (46 B) headers: version, flags (bit 11 = UTF-8), method 0, time, date, crc, sizes, name length.
    const common = (v: DataView, o: number) => {
      v.setUint16(o, 20, true); v.setUint16(o + 2, 0x0800, true); v.setUint16(o + 4, 0, true)
      v.setUint16(o + 6, time, true); v.setUint16(o + 8, date, true); v.setUint32(o + 10, crc, true)
      v.setUint32(o + 14, data.length, true); v.setUint32(o + 18, data.length, true); v.setUint16(o + 22, name.length, true)
    }
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034B50, true); common(lv, 4); local.set(name, 30)
    const cen = new Uint8Array(46 + name.length), cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014B50, true); cv.setUint16(4, 20, true); common(cv, 6); cv.setUint32(42, off, true); cen.set(name, 46)
    parts.push(local, data); central.push(cen)
    off += local.length + data.length
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22), ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054B50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, cenSize, true); ev.setUint32(16, off, true)
  const out = new Uint8Array(off + cenSize + 22)
  let p = 0
  for (const b of [...parts, ...central, end]) { out.set(b, p); p += b.length }
  return out
}
