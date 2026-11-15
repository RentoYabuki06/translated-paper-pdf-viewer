import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))
const pdfjsRoot = join(root, 'node_modules/pdfjs-dist')

const ortRoot = join(root, 'node_modules/onnxruntime-web/dist')

/**
 * ライブラリが実行時に読むファイルの置き場所。
 * URL の先頭(base)は、src/pdf/pdfjs.ts と src/layout/ortWeb.worker.ts の指定と合わせる。
 */
interface AssetMount {
  /** URL の先頭。 */
  base: string
  /** 複製元のディレクトリ。 */
  source: string
  /** 配ってよいファイルかどうか。引数は、複製元からの相対パス。 */
  allows: (relative: string) => boolean
}

const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

const ASSET_MOUNTS: AssetMount[] = [
  // PDF.js: 文字コードの対応表、標準フォント、画像の復号器など。
  { base: '/pdfjs/', source: pdfjsRoot, allows: (relative) => PDFJS_ASSET_DIRS.some((dir) => relative.startsWith(`${dir}/`)) },
  // ONNX Runtime Web: WebAssembly の本体と、その読み込み用のスクリプト。
  { base: '/ort/', source: ortRoot, allows: (relative) => /^ort-wasm[\w.-]*\.(wasm|mjs)$/.test(relative) },
]

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
}

/**
 * ASSET_MOUNTS のファイルを配る。開発時は node_modules から直接返し、ビルド時は dist/ へ複製する。
 */
function libraryAssets(): Plugin {
  let outDir = join(root, 'dist')
  return {
    name: 'library-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? '').split('?')[0] ?? '')
        const mount = ASSET_MOUNTS.find((candidate) => path.startsWith(candidate.base))
        if (!mount) return next()
        const relative = normalize(path.slice(mount.base.length))
        const file = join(mount.source, relative)
        if (!mount.allows(relative) || !existsSync(file) || !statSync(file).isFile()) return next()
        const type = CONTENT_TYPES[extname(file)]
        if (type) response.setHeader('Content-Type', type)
        createReadStream(file).pipe(response)
      })
    },
    closeBundle() {
      for (const mount of ASSET_MOUNTS) {
        cpSync(mount.source, join(outDir, mount.base), {
          recursive: true,
          filter: (source) => {
            if (statSync(source).isDirectory()) {
              const relative = source.slice(mount.source.length + 1)
              return relative === '' || PDFJS_ASSET_DIRS.includes(relative)
            }
            return mount.allows(source.slice(mount.source.length + 1))
          },
        })
      }
    },
  }
}

/**
 * WebAssembly を複数のスレッドで動かすために必要な応答ヘッダー。
 * この 2 つが無いと、ブラウザは SharedArrayBuffer を使わせず、レイアウト検出が 1 スレッドで動く。
 * credentialless は、arXiv や Hugging Face からの取得(認証情報なし)を妨げない。
 */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

/**
 * すべての応答に ISOLATION_HEADERS を付ける。
 *
 * Vite の server.headers の指定では、「変更なし」(HTTP 304)の応答にヘッダーが付かない。
 * その場合、ブラウザはヘッダーの無い古い保存分を使い続け、ワーカーのスクリプトの読み込みを拒む。
 * 実際に、PDF.js のワーカーが起動しなくなった。そのため、304 を含むすべての応答に付ける。
 */
function isolationHeaders(): Plugin {
  const middleware: Connect.NextHandleFunction = (_request, response, next) => {
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) response.setHeader(name, value)
    next()
  }
  return {
    name: 'isolation-headers',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), isolationHeaders(), libraryAssets()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
