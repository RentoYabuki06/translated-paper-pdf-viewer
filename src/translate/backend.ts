/**
 * 翻訳の依頼先(バックエンド)に共通の型。
 *
 * 最初の実装は llama-server 版(llamaServer.ts)。
 * Ollama 版やブラウザ内推論版は、この型を実装して差し替える。
 */

import type { Pfml3Request } from './pfml3.ts'

/** 依頼先のサーバーについての情報。 */
export interface BackendInfo {
  /** サーバーが報告するモデルの名前。取得できない場合は "unknown"。 */
  modelId: string
  /** 同時に処理できる依頼の数。 */
  slots: number
  /** 1 つの依頼で使える入出力の長さ(トークン数)。取得できない場合は null。 */
  contextPerSlot: number | null
}

/** 翻訳の依頼。PFML3 の各欄に、生成の上限を足したもの。 */
export interface TranslateRequest extends Pfml3Request {
  /** 生成する訳文の長さの上限(トークン数)。 */
  maxTokens: number
}

/**
 * 生成が止まった理由。
 * - eos: モデルが訳文の終わりを出した(正常終了)
 * - word: 指定した停止文字列に達した
 * - limit: maxTokens または文脈の長さの上限に達した(訳文が途中で切れている)
 * - unknown: サーバーが理由を報告しなかった
 */
export type StopReason = 'eos' | 'word' | 'limit' | 'unknown'

export interface TranslateResult {
  /** 訳文。前後の空白と、末尾の終了トークンは取り除いてある。 */
  text: string
  stopReason: StopReason
  /** 入力のトークン数。サーバーが報告しない場合は null。 */
  promptTokens: number | null
  /** 生成したトークン数。サーバーが報告しない場合は null。 */
  outputTokens: number | null
  /** 生成の速度(トークン毎秒)。サーバーが報告しない場合は null。 */
  tokensPerSecond: number | null
}

export interface TranslateOptions {
  /** 依頼を途中で取り消すための合図。 */
  signal?: AbortSignal
  /** 訳文が生成されるたびに、その時点までの訳文全体を受け取る。 */
  onText?: (textSoFar: string) => void
}

export interface TranslatorBackend {
  info(signal?: AbortSignal): Promise<BackendInfo>
  translate(request: TranslateRequest, options?: TranslateOptions): Promise<TranslateResult>
}
