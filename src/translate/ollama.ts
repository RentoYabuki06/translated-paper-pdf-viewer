/**
 * Ollama(言語モデルを動かすソフト)へ翻訳を依頼する。
 *
 * 送り先は /api/generate。PFML3 の文字列を、Ollama に整形させずに(raw)、そのまま prompt として送る。
 * llama-server 版(llamaServer.ts)と同じ型(TranslatorBackend)を実装し、差し替えて使える。
 *
 * llama-server 版との違い:
 * - 同時に処理できる依頼の数を、Ollama は応答で知らせない。利用者が指定した数を使う。
 * - llama-server の起動時に渡している位置符号化の補正(note/004_llama-launcher.md)を、渡す手段が無い。
 */

import type {
  BackendInfo,
  StopReason,
  TranslateOptions,
  TranslateRequest,
  TranslateResult,
  TranslatorBackend,
} from './backend.ts'
import { buildPfml3Prompt, cleanPfml3Output, PFML3_END_MARKERS } from './pfml3.ts'
import { readLines } from './streamLines.ts'

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

/**
 * 1 つの依頼で使う入出力の長さ(トークン数)。llama-server の 1 件あたりの長さ(8,192 を 4 件で分けた値)に合わせている。
 */
export const OLLAMA_CONTEXT_LENGTH = 2048

export class OllamaError extends Error {
  /** HTTP の状態コード。接続できなかった場合などは undefined。 */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OllamaError'
    this.status = status
  }
}

export interface OllamaOptions {
  /** Ollama の URL。末尾のスラッシュは無くてよい。 */
  baseUrl?: string
  /** 使うモデルの名前(ollama list に出る名前)。 */
  model: string
  /** 同時に依頼する数。Ollama の設定(OLLAMA_NUM_PARALLEL)に合わせる。既定は 1。 */
  parallel?: number
  /** テストで差し替えるための fetch。 */
  fetch?: typeof fetch
}

/** /api/generate が逐次返す 1 行分。使う項目だけを定義している。 */
interface GenerateEvent {
  response?: string
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  /** 生成にかかった時間(ナノ秒)。 */
  eval_duration?: number
  error?: string
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function toStopReason(reason: string | undefined): StopReason {
  // Ollama は、終了トークンで止まった場合と、停止文字列で止まった場合を、どちらも "stop" と報告する。
  if (reason === 'stop') return 'eos'
  if (reason === 'length') return 'limit'
  return 'unknown'
}

/** エラーの応答の本文から、メッセージを取り出す。Ollama は {"error": "…"} の形で返す。 */
function errorMessageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // JSON でない応答は、そのまま使う。
  }
  return body
}

export class OllamaBackend implements TranslatorBackend {
  private readonly baseUrl: string
  private readonly model: string
  private readonly parallel: number
  private readonly fetchImpl: typeof fetch

  constructor(options: OllamaOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '')
    this.model = options.model
    this.parallel = options.parallel !== undefined && Number.isInteger(options.parallel) && options.parallel > 0 ? options.parallel : 1
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init)
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new OllamaError(`Ollama(${this.baseUrl})に接続できません。Ollama が起動しているか確認してください。`)
    }
    if (!response.ok) {
      const detail = errorMessageOf(await response.text().catch(() => ''))
      throw new OllamaError(`Ollama が HTTP ${response.status} を返しました: ${detail}`, response.status)
    }
    return response
  }

  /** Ollama に入っているモデルの名前の一覧。 */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.request('/api/tags', { method: 'GET', signal: signal ?? null })
    const body = (await response.json()) as { models?: { name?: unknown }[] }
    return (body.models ?? []).map((model) => model.name).filter((name): name is string => typeof name === 'string')
  }

  async info(signal?: AbortSignal): Promise<BackendInfo> {
    if (this.model.trim().length === 0) throw new OllamaError('Ollama で使うモデルの名前を指定してください。')
    try {
      await this.request('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model }),
        signal: signal ?? null,
      })
    } catch (error) {
      if (error instanceof OllamaError && error.status === 404) {
        throw new OllamaError(`Ollama に、モデル「${this.model}」がありません。ollama list で、入っているモデルを確かめてください。`, 404)
      }
      throw error
    }
    return { modelId: this.model, slots: this.parallel, contextPerSlot: OLLAMA_CONTEXT_LENGTH }
  }

  async translate(request: TranslateRequest, options: TranslateOptions = {}): Promise<TranslateResult> {
    const { maxTokens, ...pfml3 } = request
    const payload = {
      model: this.model,
      prompt: buildPfml3Prompt(pfml3),
      // PFML3 の文字列は、すでに完成した入力である。Ollama の整形(テンプレートの適用)を通さない。
      raw: true,
      stream: true,
      options: {
        num_predict: maxTokens,
        num_ctx: OLLAMA_CONTEXT_LENGTH,
        // 生成の設定は、llama-server 版と同じ。毎回同じ結果になるよう、最も確率の高いトークンを選び続ける。
        temperature: 0,
        top_p: 1,
        min_p: 0,
        repeat_penalty: 1,
        seed: 0,
        // 訳文の終わりの印が文字として出てきた場合に備えて、停止文字列にも指定する。
        stop: [...PFML3_END_MARKERS],
      },
    }

    const response = await this.request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal ?? null,
    })
    if (!response.body) throw new OllamaError('Ollama の応答に本文がありません。')

    let raw = ''
    let final: GenerateEvent | undefined
    for await (const line of readLines(response.body)) {
      if (line.trim().length === 0) continue
      let event: GenerateEvent
      try {
        event = JSON.parse(line) as GenerateEvent
      } catch {
        throw new OllamaError(`Ollama の応答を解釈できません: ${line.slice(0, 200)}`)
      }
      if (event.error !== undefined) throw new OllamaError(`Ollama がエラーを返しました: ${event.error}`)
      if (event.response) {
        raw += event.response
        options.onText?.(cleanPfml3Output(raw))
      }
      if (event.done) {
        final = event
        break
      }
    }
    if (!final) throw new OllamaError('Ollama との接続が、翻訳の完了前に切れました。')

    const seconds = final.eval_duration !== undefined ? final.eval_duration / 1e9 : 0
    return {
      text: cleanPfml3Output(raw),
      stopReason: toStopReason(final.done_reason),
      promptTokens: final.prompt_eval_count ?? null,
      outputTokens: final.eval_count ?? null,
      tokensPerSecond: final.eval_count !== undefined && seconds > 0 ? final.eval_count / seconds : null,
    }
  }
}
