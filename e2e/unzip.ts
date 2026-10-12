// Reads the stored (uncompressed) zips written by src/export/zip.ts.
export function unzip(buf: Uint8Array): { name: string; text: string; crc: number }[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), dec = new TextDecoder(), out = []
  for (let o = 0; v.getUint32(o, true) === 0x04034B50;) {
    const size = v.getUint32(o + 18, true), n = v.getUint16(o + 26, true), x = v.getUint16(o + 28, true)
    const name = dec.decode(buf.subarray(o + 30, o + 30 + n)), at = o + 30 + n + x
    out.push({ name, text: dec.decode(buf.subarray(at, at + size)), crc: v.getUint32(o + 14, true) })
    o = at + size
  }
  return out
}
