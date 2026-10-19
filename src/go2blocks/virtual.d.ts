// vite.config.ts go2Blocks(): the CSVs in public/go2-blocks/<folder>/ (file without .csv)
declare module 'virtual:go2-blocks' {
  const files: { folder: string; file: string }[]
  export default files
}
