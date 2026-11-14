import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LlamaServerBackend, LlamaServerError } from '../../src/translate/llamaServer.ts'
import { buildPfml3Prompt } from '../../src/translate/pfml3.ts'

// llama-server の /completion と /props の応答形式をまねる模擬サーバーで検証する。
// 実物の llama-server に対する動作は、このテストでは確かめていない。

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void | Promise<void>

let server: Server | undefined

async function startMockServer(handler: Handler): Promise<string> {
  const created = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void handler(request, Buffer.concat(chunks).toString('utf8'), response)
    })
  })
  server = created
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve))
  const { port } = created.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function stopMockServer(): Promise<void> {
  const current = server
  server = undefined
  if (!current) return
  current.closeAllConnections()
  await new Promise<void>((resolve) => current.close(() => resolve()))
}

function sseLine(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function startSse(response: ServerResponse): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
}

const finalEvent = {
  content: '',
  stop: true,
  stop_type: 'eos',
  truncated: false,
  tokens_evaluated: 21,
  tokens_predicted: 9,
  timings: { prompt_n: 21, predicted_n: 9, predicted_per_second: 87.5 },
}

afterEach(stopMockServer)

describe('LlamaServerBackend.translate', () => {
  it('PFML3 の文字列を /completion へ送り、逐次届く訳文をつなげて返す', async () => {
    let path = ''
    let received: Record<string, unknown> = {}
    const baseUrl = await startMockServer((request, body, response) => {
      path = request.url ?? ''
      received = JSON.parse(body) as Record<string, unknown>
      startSse(response)
      response.write(sseLine({ content: 'これは', stop: false }))
      response.write(sseLine({ content: '便利である。', stop: false }))
      response.end(sseLine(finalEvent))
    })

    const snapshots: string[] = []
    const backend = new LlamaServerBackend({ baseUrl })
    const result = await backend.translate(
      { source: 'This is convenient.', sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 256 },
      { onText: (text) => snapshots.push(text) },
    )

    expect(path).toBe('/completion')
    expect(received.prompt).toBe(
      buildPfml3Prompt({ source: 'This is convenient.', sourceLang: 'en', targetLang: 'ja', form: 'plain' }),
    )
    expect(received).toMatchObject({ stream: true, n_predict: 256, temperature: 0, cache_prompt: false, stop: [] })
    expect(snapshots).toEqual(['これは', 'これは便利である。'])
    expect(result).toEqual({
      text: 'これは便利である。',
      stopReason: 'eos',
      promptTokens: 21,
      outputTokens: 9,
      tokensPerSecond: 87.5,
    })
  })

  it('通信の区切りが文字の途中に入っても、正しく復元する', async () => {
    const baseUrl = await startMockServer(async (_request, _body, response) => {
      startSse(response)
      const bytes = Buffer.from(sseLine({ content: '日本語の訳文', stop: false }) + sseLine(finalEvent), 'utf8')
      // "日" は UTF-8 で 3 バイト。その途中(2 バイト目の後)で分割する。
      const cut = bytes.indexOf(Buffer.from('日', 'utf8')) + 2
      response.write(bytes.subarray(0, cut))
      await new Promise((resolve) => setTimeout(resolve, 20))
      response.end(bytes.subarray(cut))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    const result = await backend.translate({ source: 'Japanese translation', targetLang: 'ja', maxTokens: 64 })
    expect(result.text).toBe('日本語の訳文')
  })

  it('末尾に残った終了トークンと空白を取り除く', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      startSse(response)
      response.write(sseLine({ content: ' 訳文である。<|plamo:tag|>', stop: false }))
      response.end(sseLine(finalEvent))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    const result = await backend.translate({ source: 'A translation.', targetLang: 'ja', maxTokens: 64 })
    expect(result.text).toBe('訳文である。')
  })

  it('上限に達して止まった場合は stopReason を limit にする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      startSse(response)
      response.write(sseLine({ content: '途中まで', stop: false }))
      response.end(sseLine({ ...finalEvent, stop_type: 'limit' }))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    const result = await backend.translate({ source: 'A long text.', targetLang: 'ja', maxTokens: 4 })
    expect(result.stopReason).toBe('limit')
    expect(result.text).toBe('途中まで')
  })

  it('サーバーがエラーのイベントを返したら失敗にする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      startSse(response)
      response.end(sseLine({ error: { message: 'the request exceeds the available context size' } }))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    await expect(backend.translate({ source: 'x', targetLang: 'ja', maxTokens: 8 })).rejects.toThrow(
      /the request exceeds the available context size/,
    )
  })

  it('HTTP のエラーは状態コード付きで失敗にする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Loading model' } }))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    const error = await backend.translate({ source: 'x', targetLang: 'ja', maxTokens: 8 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlamaServerError)
    expect((error as LlamaServerError).status).toBe(503)
  })

  it('完了のイベントが届く前に接続が切れたら失敗にする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      startSse(response)
      response.end(sseLine({ content: '途中', stop: false }))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    await expect(backend.translate({ source: 'x', targetLang: 'ja', maxTokens: 8 })).rejects.toThrow(
      /完了前に切れました/,
    )
  })

  it('取り消しの合図で依頼を中断できる', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      startSse(response)
      // 最初の断片だけを送り、その後は応答を終えない。
      response.write(sseLine({ content: '最初の断片', stop: false }))
    })

    const controller = new AbortController()
    const backend = new LlamaServerBackend({ baseUrl })
    const error = await backend
      .translate(
        { source: 'x', targetLang: 'ja', maxTokens: 8 },
        { signal: controller.signal, onText: () => controller.abort() },
      )
      .catch((e: unknown) => e)
    expect((error as Error).name).toBe('AbortError')
  })

  it('サーバーに接続できない場合は、その旨のエラーにする', async () => {
    // いったん起動して止めることで、誰も待ち受けていないポート番号を得る。
    const baseUrl = await startMockServer(() => undefined)
    await stopMockServer()

    const backend = new LlamaServerBackend({ baseUrl })
    const error = await backend.translate({ source: 'x', targetLang: 'ja', maxTokens: 8 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlamaServerError)
    expect((error as LlamaServerError).message).toMatch(/接続できません/)
  })
})

describe('LlamaServerBackend.info', () => {
  it('/props からモデル名、同時処理数、文脈の長さを読み取る', async () => {
    let path = ''
    const baseUrl = await startMockServer((request, _body, response) => {
      path = request.url ?? ''
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          total_slots: 4,
          model_alias: 'plamo-3-translate',
          model_path: '/cache/plamo-3-translate-2b-Q4_K_M.gguf',
          default_generation_settings: { n_ctx: 8192 },
        }),
      )
    })

    // URL の末尾にスラッシュがあっても、パスが二重にならない。
    const backend = new LlamaServerBackend({ baseUrl: `${baseUrl}/` })
    expect(await backend.info()).toEqual({ modelId: 'plamo-3-translate', slots: 4, contextPerSlot: 8192 })
    expect(path).toBe('/props')
  })

  it('項目が欠けている場合は、安全な既定値にする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ model_path: '/cache/plamo-3-translate-8b-Q4_K_M.gguf' }))
    })

    const backend = new LlamaServerBackend({ baseUrl })
    expect(await backend.info()).toEqual({
      modelId: 'plamo-3-translate-8b-Q4_K_M.gguf',
      slots: 1,
      contextPerSlot: null,
    })
  })
})
