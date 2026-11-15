/**
 * 画面側と、レイアウト検出のワーカーの間でやり取りするメッセージの型。
 * 画面側がワーカーの中身(ONNX Runtime Web)を読み込まないよう、ワーカーとは別のファイルに置く。
 */

import type { LayoutBackend } from './types.ts'

/** モデルの入力の画像の一辺(画素)。 */
export const INPUT_SIZE = 800

export interface InitRequest {
  type: 'init'
  modelUrl: string
  /** モデルのファイルの SHA-256(16 進)。取得したファイルと一致しなければ使わない。 */
  modelSha256: string
  backend: LayoutBackend
  /** ONNX Runtime Web の WebAssembly のファイルを置いた URL(末尾はスラッシュ)。 */
  wasmBase: string
}

export interface RunRequest {
  type: 'run'
  id: number
  /** ページの画像。受け取ったあと、ワーカーが破棄する。 */
  bitmap: ImageBitmap
}

export type WorkerRequest = InitRequest | RunRequest

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number | null }
  | { type: 'ready'; backend: LayoutBackend; threads: number; inputNames: string[]; outputNames: string[] }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; outputs: RawOutput[]; milliseconds: number }
  | { type: 'run-error'; id: number; message: string }

/** モデルの出力 1 つ。 */
export interface RawOutput {
  name: string
  dims: number[]
  data: Float32Array | Int32Array
}
