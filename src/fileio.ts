// The only module that touches file APIs. Swap this file when wrapping in Tauri/Electron.
type Picker = (o: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const pick = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
  if (!pick) return null
  try {
    return await pick.call(window, { mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

export async function writeTextFiles(
  dir: FileSystemDirectoryHandle | null,
  files: { name: string; text: string }[],
): Promise<void> {
  for (const { name, text } of files) {
    if (dir) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(text)
      await w.close()
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }
}

type OpenPicker = (o: { multiple: boolean; types: { accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>

const readAll = (files: File[]) => Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })))

export async function openTextFiles(accept: string, multiple: boolean): Promise<{ name: string; text: string }[]> {
  const pick = (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker
  if (typeof pick === 'function') {
    try {
      const hs = await pick.call(window, { multiple, types: [{ accept: { 'text/plain': accept.split(',') } }] })
      return await readAll(await Promise.all(hs.map(h => h.getFile())))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return []
      throw e
    }
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.multiple = multiple; input.hidden = true
    let done = false
    const finish = (files: File[]) => {
      if (done) return
      done = true
      input.remove()
      window.removeEventListener('focus', onFocus)
      readAll(files).then(resolve)
    }
    // Cancel: the `cancel` event, or window focus returning with no change event (older browsers).
    const onFocus = () => setTimeout(() => finish([]), 1000)
    input.addEventListener('change', () => finish([...(input.files ?? [])]))
    input.addEventListener('cancel', () => finish([]))
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
}
