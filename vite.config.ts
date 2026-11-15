import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))
const pdfjsRoot = join(root, 'node_modules/pdfjs-dist')

/** PDF.js が実行時に読むファイルの置き場所。src/pdf/pdfjs.ts の URL と合わせる。 */
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
const PDFJS_ASSET_BASE = '/pdfjs/'

/**
 * PDF.js が実行時に読むファイル(文字コードの対応表、標準フォント、画像の復号器など)を、
 * /pdfjs/ 以下で配る。開発時は node_modules から直接返し、ビルド時は dist/pdfjs/ へ複製する。
 */
function pdfjsAssets(): Plugin {
  let outDir = join(root, 'dist')
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? '').split('?')[0] ?? '')
        if (!path.startsWith(PDFJS_ASSET_BASE)) return next()
        const relative = normalize(path.slice(PDFJS_ASSET_BASE.length))
        const allowed = PDFJS_ASSET_DIRS.some((dir) => relative.startsWith(`${dir}/`))
        const file = join(pdfjsRoot, relative)
        if (!allowed || !existsSync(file) || !statSync(file).isFile()) return next()
        if (file.endsWith('.wasm')) response.setHeader('Content-Type', 'application/wasm')
        createReadStream(file).pipe(response)
      })
    },
    closeBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        cpSync(join(pdfjsRoot, dir), join(outDir, 'pdfjs', dir), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
