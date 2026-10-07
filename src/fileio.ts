// The only module that touches file APIs. Swap this file when wrapping in Tauri/Electron.
type Picker = () => Promise<FileSystemDirectoryHandle>

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const pick = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
  if (!pick) return null
  try {
    return await pick.call(window)
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
