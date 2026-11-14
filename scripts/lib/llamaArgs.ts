/**
 * llama-server の起動に使う、モデルの指定と引数の組み立て。
 */

/** PFN が公開している PLaMo 3 Translate の大きさ。 */
export const MODEL_SIZES = ['0.8b', '2b', '8b', '31b'] as const
export type ModelSize = (typeof MODEL_SIZES)[number]

export const DEFAULT_MODEL_SIZE: ModelSize = '2b'
/** 量子化の種類。PFN がモデルカードで既定として勧めている形式。 */
export const DEFAULT_QUANT = 'Q4_K_M'
export const DEFAULT_PORT = 8080
export const DEFAULT_PARALLEL = 4
/** 1 回の依頼で使う入出力の上限(トークン数)。 */
export const TOKENS_PER_REQUEST = 2048
/** アプリと実験スクリプトが、依頼先のモデルを指すために使う名前。 */
export const MODEL_ALIAS = 'plamo-3-translate'

export function isModelSize(value: string): value is ModelSize {
  return (MODEL_SIZES as readonly string[]).includes(value)
}

/** Hugging Face 上のリポジトリ名。例: pfnet/plamo-3-translate-2b-GGUF */
export function ggufRepository(size: ModelSize): string {
  return `pfnet/plamo-3-translate-${size}-GGUF`
}

/** GGUF ファイルの URL。先頭部分だけを読んで、モデルの情報を得るために使う。 */
export function ggufFileUrl(size: ModelSize, quant: string): string {
  return `https://huggingface.co/${ggufRepository(size)}/resolve/main/plamo-3-translate-${size}-${quant}.gguf`
}

export interface LlamaServerArgumentOptions {
  size: ModelSize
  quant: string
  port: number
  /** 同時に処理する依頼の数。 */
  parallel: number
  /** 位置符号化の補正オプション(yarnRangeArguments の結果)。 */
  yarnArguments: readonly string[]
}

/** llama-server に渡す引数の一覧を作る。 */
export function buildLlamaServerArguments(options: LlamaServerArgumentOptions): string[] {
  const { size, quant, port, parallel, yarnArguments } = options
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ポート番号が不正です: ${port}`)
  }
  if (!Number.isInteger(parallel) || parallel < 1) {
    throw new Error(`同時処理数が不正です: ${parallel}`)
  }
  return [
    // 初回は Hugging Face からモデルを取得し、llama.cpp のキャッシュに保存する。
    '-hf',
    `${ggufRepository(size)}:${quant}`,
    '--alias',
    MODEL_ALIAS,
    // 自分のマシンからの接続だけを受け付ける。
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--parallel',
    String(parallel),
    '--ctx-size',
    String(TOKENS_PER_REQUEST * parallel),
    // 文脈があふれたときに先頭を捨てて続行する動作を止める。訳文が黙って壊れるのを防ぐ。
    '--no-context-shift',
    '--no-webui',
    // 依頼は PFML3 の文字列を /completion へ送るので、チャット用の書式は使わない。
    // GGUF に埋め込まれた書式は訳先の言語が無いとエラーになり、起動時の検査で失敗しうるため、
    // 組み込みの書式に差し替える。
    '--chat-template',
    'chatml',
    // 依頼は互いに独立しており、計算結果を再利用しないので、保存の処理を省く。
    '--cache-ram',
    '0',
    '--ctx-checkpoints',
    '0',
    ...yarnArguments,
  ]
}
