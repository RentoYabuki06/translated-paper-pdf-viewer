/**
 * PDF.js の初期設定と、PDF の読み込み。
 *
 * PDF の解釈は、PDF.js のワーカー(画面とは別のスレッド)で行う。
 * 文字コードの対応表などのファイルは /pdfjs/ 以下から読む(vite.config.ts の pdfjsAssets が配る)。
 */

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`

/** PDF のデータを読み込む。渡したデータは PDF.js のワーカーへ移され、呼び出し側では使えなくなる。 */
export function loadPdf(data: ArrayBuffer): PDFDocumentLoadingTask {
  return getDocument({
    data,
    cMapUrl: `${ASSET_BASE}cmaps/`,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    // PDF に書かれたフォントの名前(数式の検出に使う)を、フォントの情報に含めさせる。
    fontExtraProperties: true,
  })
}
