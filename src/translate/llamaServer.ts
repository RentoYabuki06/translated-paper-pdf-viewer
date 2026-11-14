/**
 * llama-server(llama.cpp 付属の HTTP サーバー)へ翻訳を依頼する。
 *
 * 送り先は /completion。PFML3 の文字列をそのまま prompt として送り、訳文を逐次受け取る。
 * 依頼の各項目は、PFN 公式 CLI(pfnet/plamo-translate-cli)が llama-server へ送る内容に合わせている。
 */

import type {
  BackendInfo,
  StopReason,
  TranslateOptions,
  TranslateRequest,
  TranslateResult,
  TranslatorBackend,
} from './backend.ts'
import { buildPfml3Prompt, cleanPfml3Output } from './pfml3.ts'

export const DEFAULT_LLAMA_SERVER_URL = 'http://127.0.0.1:8080'

export class LlamaServerError extends Error {
  /** HTTP の状態コード。接続できなかった場合などは undefined。 */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LlamaServerError'
    this.status = status
  }
}

export interface LlamaServerOptions {
  /** llama-server の URL。末尾のスラッシュは無くてよい。 */
  baseUrl?: string
  /** テストで差し替えるための fetch。 */
  fetch?: typeof fetch
}

/** /completion が逐次返すイベント。使う項目だけを定義している。 */
interface CompletionEvent {
  content?: string
  stop?: boolean
  stop_type?: string
  truncated?: boolean
  tokens_evaluated?: number
  tokens_predicted?: number
  timings?: {
    prompt_n?: number
    predicted_n?: number
    predicted_per_second?: number
  }
  error?: { message?: string } | string
}

/** /props の応答。使う項目だけを定義している。 */
interface PropsResponse {
  total_slots?: number
  model_alias?: string
  model_path?: string
  default_generation_settings?: { n_ctx?: number }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function toStopReason(event: CompletionEvent): StopReason {
  if (event.truncated || event.stop_type === 'limit') return 'limit'
  if (event.stop_type === 'eos') return 'eos'
  if (event.stop_type === 'word') return 'word'
  return 'unknown'
}

function errorMessageOf(error: NonNullable<CompletionEvent['error']>): string {
  if (typeof error === 'string') return error
  return error.message ?? JSON.stringify(error)
}

/**
 * Server-Sent Events の本文から、"data:" 行の中身を 1 件ずつ取り出す。
 * 通信の区切りは行や文字の途中に入りうるため、行が揃うまで溜めてから返す。
 */
async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) yield line.slice(5).trim()
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    const rest = buffer.replace(/\r$/, '')
    if (rest.startsWith('data:')) yield rest.slice(5).trim()
  } finally {
    // 途中で読むのをやめた場合に、サーバーとの接続を閉じる。
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class LlamaServerBackend implements TranslatorBackend {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: LlamaServerOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_LLAMA_SERVER_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`
    let response: Response
    try {
      response = await this.fetchImpl(url, init)
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new LlamaServerError(
        `llama-server(${this.baseUrl})に接続できません。サーバーが起動しているか確認してください。`,
      )
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LlamaServerError(`llama-server が HTTP ${response.status} を返しました: ${detail}`, response.status)
    }
    return response
  }

  async info(signal?: AbortSignal): Promise<BackendInfo> {
    const response = await this.request('/props', { method: 'GET', signal: signal ?? null })
    const props = (await response.json()) as PropsResponse
    const modelFile = props.model_path?.split('/').pop()
    return {
      modelId: props.model_alias || modelFile || 'unknown',
      slots: props.total_slots && props.total_slots > 0 ? props.total_slots : 1,
      contextPerSlot: props.default_generation_settings?.n_ctx ?? null,
    }
  }

  async translate(request: TranslateRequest, options: TranslateOptions = {}): Promise<TranslateResult> {
    const { maxTokens, ...pfml3 } = request
    const payload = {
      prompt: buildPfml3Prompt(pfml3),
      stream: true,
      n_predict: maxTokens,
      // 翻訳は毎回同じ結果になるよう、最も確率の高いトークンを選び続ける。
      temperature: 0,
      // 上の設定では絞り込みが不要なため、語彙全体の並べ替えを避ける。
      top_p: 1,
      min_p: 0,
      repeat_penalty: 1,
      seed: 0,
      // PLaMo 3 の GGUF は、訳文の終わりを示すトークンで自分から生成を止める。
      stop: [],
      // 依頼は互いに独立しており、前の依頼の計算結果を再利用しない。
      cache_prompt: false,
    }

    const response = await this.request('/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal ?? null,
    })
    if (!response.body) {
      throw new LlamaServerError('llama-server の応答に本文がありません。')
    }

    let raw = ''
    let final: CompletionEvent | undefined
    for await (const data of readSseData(response.body)) {
      if (data === '[DONE]') break
      let event: CompletionEvent
      try {
        event = JSON.parse(data) as CompletionEvent
      } catch {
        throw new LlamaServerError(`llama-server の応答を解釈できません: ${data.slice(0, 200)}`)
      }
      if (event.error !== undefined) {
        throw new LlamaServerError(`llama-server がエラーを返しました: ${errorMessageOf(event.error)}`)
      }
      if (event.content) {
        raw += event.content
        options.onText?.(cleanPfml3Output(raw))
      }
      if (event.stop) {
        final = event
        break
      }
    }
    if (!final) {
      throw new LlamaServerError('llama-server との接続が、翻訳の完了前に切れました。')
    }

    return {
      text: cleanPfml3Output(raw),
      stopReason: toStopReason(final),
      promptTokens: final.tokens_evaluated ?? final.timings?.prompt_n ?? null,
      outputTokens: final.tokens_predicted ?? final.timings?.predicted_n ?? null,
      tokensPerSecond: final.timings?.predicted_per_second ?? null,
    }
  }
}
