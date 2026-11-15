/**
 * PP-DocLayoutV3 を ONNX Runtime Web で実行するワーカー。
 * 画面を止めないよう、モデルの取得と推論を、画面とは別のスレッドで行う。
 */

import * as ort from 'onnxruntime-web/webgpu'
import { INPUT_SIZE } from './protocol.ts'
import type { InitRequest, RawOutput, RunRequest, WorkerRequest, WorkerResponse } from './protocol.ts'

const CACHE_NAME = 'layout-model-v1'

let session: ort.InferenceSession | undefined
const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE)

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 取得の進み具合を知らせながら、応答の本文を読む。 */
async function readWithProgress(response: Response): Promise<ArrayBuffer> {
  const header = response.headers.get('Content-Length')
  const total = header ? Number(header) : null
  if (!response.body) return response.arrayBuffer()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    post({ type: 'progress', loaded, total })
  }
  const data = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return data.buffer
}

/**
 * モデルのファイルを取得する。2 回目以降は、ブラウザに保存したものを使う。
 * 保存するのは、ハッシュ値が一致したファイルだけ。
 */
async function loadModel(url: string, sha256: string): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME).catch(() => undefined)
  const cached = await cache?.match(url)
  if (cached) return cached.arrayBuffer()

  const response = await fetch(url)
  if (!response.ok) throw new Error(`モデルの取得で HTTP ${response.status} が返りました`)
  const data = await readWithProgress(response)
  const actual = toHex(await crypto.subtle.digest('SHA-256', data))
  if (actual !== sha256) {
    throw new Error(`取得したモデルのハッシュ値が一致しません(${actual.slice(0, 16)}…)`)
  }
  await cache?.put(url, new Response(data.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined)
  return data
}

async function init(request: InitRequest): Promise<void> {
  ort.env.wasm.wasmPaths = request.wasmBase
  // SharedArrayBuffer が使えない場合(応答ヘッダーが無い場合)は、1 スレッドで動く。
  const threads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1
  ort.env.wasm.numThreads = threads

  const model = await loadModel(request.modelUrl, request.modelSha256)
  session = await ort.InferenceSession.create(model, {
    executionProviders: [request.backend],
    graphOptimizationLevel: 'all',
  })
  post({
    type: 'ready',
    backend: request.backend,
    threads: request.backend === 'wasm' ? threads : 1,
    inputNames: [...session.inputNames],
    outputNames: [...session.outputNames],
  })
}

/**
 * ページの画像を、モデルの入力の形にする。
 * 縦横比を保たずに 800×800 へ縮め、画素の値を 0 から 1 にし、RGB の順に色ごとに並べる(inference.yml の Preprocess)。
 */
function preprocess(bitmap: ImageBitmap): Float32Array {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('OffscreenCanvas の 2D コンテキストを取得できません')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  context.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE)
  const { data } = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
  const plane = INPUT_SIZE * INPUT_SIZE
  const input = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    input[i] = (data[i * 4] as number) / 255
    input[plane + i] = (data[i * 4 + 1] as number) / 255
    input[2 * plane + i] = (data[i * 4 + 2] as number) / 255
  }
  return input
}

async function run(request: RunRequest): Promise<void> {
  if (!session) throw new Error('モデルの読み込みが終わっていません')
  const started = performance.now()
  const image = preprocess(request.bitmap)
  request.bitmap.close()

  // 出力の座標は、入力の画像(800×800)の画素で受け取る。ページの座標への換算は、呼び出し側で行う。
  const candidates: Record<string, ort.Tensor> = {
    image: new ort.Tensor('float32', image, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    im_shape: new ort.Tensor('float32', new Float32Array([INPUT_SIZE, INPUT_SIZE]), [1, 2]),
    scale_factor: new ort.Tensor('float32', new Float32Array([1, 1]), [1, 2]),
  }
  const feeds: Record<string, ort.Tensor> = {}
  for (const name of session.inputNames) {
    const tensor = candidates[name]
    if (!tensor) throw new Error(`モデルの入力 ${name} に渡す値が分かりません`)
    feeds[name] = tensor
  }

  const results = await session.run(feeds)
  const outputs: RawOutput[] = []
  const transfer: Transferable[] = []
  for (const name of session.outputNames) {
    const tensor = results[name]
    if (!tensor) continue
    // GPU 上にある出力は、ここで取り出す。
    const values = (await tensor.getData()) as ort.Tensor['data']
    const data = values instanceof Int32Array ? new Int32Array(values) : Float32Array.from(values as ArrayLike<number>, Number)
    outputs.push({ name, dims: [...tensor.dims], data })
    transfer.push(data.buffer)
    tensor.dispose()
  }
  post({ type: 'result', id: request.id, outputs, milliseconds: performance.now() - started }, transfer)
}

// 推論は 1 件ずつ順に行う。
let queue: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'init') {
    queue = queue.then(() =>
      init(request).catch((error: unknown) => {
        post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) })
      }),
    )
  } else {
    queue = queue.then(() =>
      run(request).catch((error: unknown) => {
        post({ type: 'run-error', id: request.id, message: error instanceof Error ? error.message : String(error) })
      }),
    )
  }
}
