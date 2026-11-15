/**
 * レイアウト検出のワーカー(ortWeb.worker.ts)を、画面側から使うための窓口。
 */

import { INPUT_SIZE } from './protocol.ts'
import type { InitRequest, RunRequest, WorkerResponse } from './protocol.ts'
import { parseRegions, ROW_LENGTH } from './parse.ts'
import type { LayoutBackend, LayoutResult } from './types.ts'

/**
 * モデルの取得元。PaddlePaddle が Hugging Face で公開している ONNX 形式のファイル(Apache-2.0)。
 * 取得するファイルが変わらないよう、リポジトリの版(コミット)を固定している。
 */
const MODEL_URL =
  'https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx/resolve/46bbdf188bb0a772c08aed74882ce7e51a8f1ea6/inference.onnx'
const MODEL_SHA256 = '45bf71750b00739a41fc209f132eb104a4d6b5bb29483c9078164d8b87cf28ba'
/** モデルのファイルの大きさ(バイト)。取得の進み具合の表示に使う。 */
export const MODEL_BYTES = 130_502_049

export interface DetectorInfo {
  backend: LayoutBackend
  /** WebAssembly で使うスレッドの数。WebGPU の場合は 1。 */
  threads: number
}

interface Pending {
  resolve: (result: LayoutResult) => void
  reject: (error: Error) => void
  pageWidth: number
  pageHeight: number
}

export class LayoutDetector {
  readonly info: DetectorInfo
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  private constructor(worker: Worker, info: DetectorInfo) {
    this.worker = worker
    this.info = info
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data)
  }

  /**
   * ワーカーを起動し、モデルを読み込む。
   * 初回はモデルのファイル(約 130 MB)を取得する。2 回目以降は、ブラウザに保存したものを使う。
   */
  static create(backend: LayoutBackend, onProgress?: (loaded: number, total: number) => void): Promise<LayoutDetector> {
    const worker = new Worker(new URL('./ortWeb.worker.ts', import.meta.url), { type: 'module' })
    return new Promise((resolve, reject) => {
      function fail(message: string): void {
        worker.terminate()
        reject(new Error(message))
      }
      worker.onerror = (event) => fail(event.message || 'レイアウト検出のワーカーを起動できませんでした')
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data
        if (message.type === 'progress') {
          onProgress?.(message.loaded, message.total ?? MODEL_BYTES)
        } else if (message.type === 'ready') {
          console.debug('[layout] 入力:', message.inputNames, '出力:', message.outputNames)
          resolve(new LayoutDetector(worker, { backend: message.backend, threads: message.threads }))
        } else if (message.type === 'init-error') {
          fail(message.message)
        }
      }
      const request: InitRequest = {
        type: 'init',
        modelUrl: MODEL_URL,
        modelSha256: MODEL_SHA256,
        backend,
        wasmBase: new URL(`${import.meta.env.BASE_URL}ort/`, location.href).href,
      }
      worker.postMessage(request)
    })
  }

  private onMessage(message: WorkerResponse): void {
    if (message.type !== 'result' && message.type !== 'run-error') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.type === 'run-error') {
      pending.reject(new Error(message.message))
      return
    }
    // 領域の表は、1 行が ROW_LENGTH 個の数値でできた、小数の出力。
    const table = message.outputs.find(
      (output) => output.data instanceof Float32Array && output.dims.length === 2 && output.dims[1] === ROW_LENGTH,
    )
    if (!table) {
      const shapes = message.outputs.map((output) => `${output.name}[${output.dims.join('×')}]`).join('、')
      pending.reject(new Error(`モデルの出力から領域の表を見つけられません(${shapes})`))
      return
    }
    pending.resolve({
      regions: parseRegions({
        rows: table.data,
        inputSize: INPUT_SIZE,
        pageWidth: pending.pageWidth,
        pageHeight: pending.pageHeight,
      }),
      milliseconds: message.milliseconds,
    })
  }

  /**
   * 描画済みのページから、領域を検出する。
   * pageWidth と pageHeight は、ページの大きさ(ポイント)。返す領域の座標は、この単位になる。
   */
  async detect(canvas: HTMLCanvasElement, pageWidth: number, pageHeight: number): Promise<LayoutResult> {
    // モデルの入力は縦横比を保たない 800×800 の画像なので、ここで縮めてからワーカーへ渡す。
    const bitmap = await createImageBitmap(canvas, {
      resizeWidth: INPUT_SIZE,
      resizeHeight: INPUT_SIZE,
      resizeQuality: 'high',
    })
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, pageWidth, pageHeight })
      const request: RunRequest = { type: 'run', id, bitmap }
      this.worker.postMessage(request, [bitmap])
    })
  }

  dispose(): void {
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('レイアウト検出を終了しました'))
    this.pending.clear()
  }
}
