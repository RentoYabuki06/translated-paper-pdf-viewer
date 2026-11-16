import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { OllamaBackend, OllamaError, OLLAMA_CONTEXT_LENGTH } from '../../src/translate/ollama.ts'
import { buildPfml3Prompt } from '../../src/translate/pfml3.ts'

// Ollama の /api/generate、/api/show、/api/tags の応答形式をまねる模擬サーバーで検証する。
// 応答の形式は、Ollama 0.40.16 の実際の応答に合わせている。

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

function line(event: unknown): string {
  return `${JSON.stringify(event)}\n`
}

const finalEvent = {
  model: 'plamo',
  response: '',
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 21,
  eval_count: 9,
  eval_duration: 100_000_000,
}

const REQUEST = { source: 'The meeting was moved.', sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 64 } as const

afterEach(stopMockServer)

describe('OllamaBackend.translate', () => {
  it('PFML3 の文字列を、整形なしの指定で /api/generate へ送り、逐次届く訳文をつなげて返す', async () => {
    let path = ''
    let received: Record<string, unknown> = {}
    const baseUrl = await startMockServer((request, body, response) => {
      path = request.url ?? ''
      received = JSON.parse(body) as Record<string, unknown>
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      response.write(line({ model: 'plamo', response: '会議は', done: false }))
      response.write(line({ model: 'plamo', response: '変更された。', done: false }))
      response.end(line(finalEvent))
    })

    const seen: string[] = []
    const backend = new OllamaBackend({ baseUrl, model: 'plamo' })
    const result = await backend.translate(REQUEST, { onText: (text) => seen.push(text) })

    expect(path).toBe('/api/generate')
    const { maxTokens: _maxTokens, ...pfml3 } = REQUEST
    expect(received).toMatchObject({ model: 'plamo', prompt: buildPfml3Prompt(pfml3), raw: true, stream: true })
    expect(received.options).toMatchObject({ num_predict: 64, num_ctx: OLLAMA_CONTEXT_LENGTH, temperature: 0, seed: 0 })
    expect(seen).toEqual(['会議は', '会議は変更された。'])
    expect(result).toEqual({
      text: '会議は変更された。',
      stopReason: 'eos',
      promptTokens: 21,
      outputTokens: 9,
      tokensPerSecond: 90,
    })
  })

  it('通信の区切りが行や文字の途中に入っても、正しく読む', async () => {
    const baseUrl = await startMockServer(async (_request, _body, response) => {
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      const bytes = Buffer.from(line({ response: '会議は変更された。', done: false }) + line(finalEvent), 'utf8')
      // 3 バイトずつ送る。日本語の 1 文字(3 バイト)の途中や、行の途中で切れる。
      for (let offset = 0; offset < bytes.length; offset += 4) {
        response.write(bytes.subarray(offset, offset + 4))
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      response.end()
    })
    const result = await new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST)
    expect(result.text).toBe('会議は変更された。')
  })

  it('長さの上限で止まった場合は、limit と報告する', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200)
      response.write(line({ response: '会議は', done: false }))
      response.end(line({ ...finalEvent, done_reason: 'length' }))
    })
    const result = await new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST)
    expect(result).toMatchObject({ text: '会議は', stopReason: 'limit' })
  })

  it('訳文の末尾に残った終了の印を取り除く', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200)
      response.write(line({ response: '会議は変更された。<|plamo:tag|>', done: false }))
      response.end(line(finalEvent))
    })
    const result = await new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST)
    expect(result.text).toBe('会議は変更された。')
  })

  it('モデルが無い場合(HTTP 404)は、Ollama のメッセージを含むエラーにする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: "model 'plamo' not found" }))
    })
    const error = await new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OllamaError)
    expect((error as OllamaError).status).toBe(404)
    expect((error as OllamaError).message).toContain("model 'plamo' not found")
  })

  it('応答の途中でエラーが届いた場合は、エラーにする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200)
      response.write(line({ response: '会議', done: false }))
      response.end(line({ error: 'out of memory' }))
    })
    await expect(new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST)).rejects.toThrow('out of memory')
  })

  it('完了の行が届く前に接続が切れた場合は、エラーにする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200)
      response.end(line({ response: '会議', done: false }))
    })
    await expect(new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST)).rejects.toThrow('完了前に切れました')
  })

  it('接続できない場合は、起動を確かめるよう案内する', async () => {
    const baseUrl = await startMockServer(() => undefined)
    await stopMockServer()
    await expect(new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST)).rejects.toThrow('接続できません')
  })

  it('取り消しの合図で、依頼を中断する', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200)
      response.write(line({ response: '会議', done: false }))
      // 完了の行を送らずに、接続を開いたままにする。
    })
    const controller = new AbortController()
    const promise = new OllamaBackend({ baseUrl, model: 'plamo' }).translate(REQUEST, {
      signal: controller.signal,
      onText: () => controller.abort(),
    })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('OllamaBackend.info', () => {
  it('モデルがあることを確かめ、指定した同時処理数を返す', async () => {
    let path = ''
    let received: Record<string, unknown> = {}
    const baseUrl = await startMockServer((request, body, response) => {
      path = request.url ?? ''
      received = JSON.parse(body) as Record<string, unknown>
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ details: { family: 'plamo3' }, model_info: { 'general.architecture': 'plamo3' } }))
    })
    const info = await new OllamaBackend({ baseUrl, model: 'plamo', parallel: 2 }).info()
    expect(path).toBe('/api/show')
    expect(received).toEqual({ model: 'plamo' })
    expect(info).toEqual({ modelId: 'plamo', slots: 2, contextPerSlot: OLLAMA_CONTEXT_LENGTH })
  })

  it('同時処理数の指定が無い場合や、正しくない場合は、1 にする', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{}')
    })
    expect((await new OllamaBackend({ baseUrl, model: 'plamo' }).info()).slots).toBe(1)
    expect((await new OllamaBackend({ baseUrl, model: 'plamo', parallel: 0 }).info()).slots).toBe(1)
  })

  it('モデルが無い場合は、入っているモデルを確かめるよう案内する', async () => {
    const baseUrl = await startMockServer((_request, _body, response) => {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: "model 'plamo:latest' not found" }))
    })
    await expect(new OllamaBackend({ baseUrl, model: 'plamo' }).info()).rejects.toThrow('モデル「plamo」がありません')
  })

  it('モデルの名前が空の場合は、依頼せずにエラーにする', async () => {
    await expect(new OllamaBackend({ baseUrl: 'http://127.0.0.1:1', model: ' ' }).info()).rejects.toThrow('モデルの名前を指定')
  })
})

describe('OllamaBackend.listModels', () => {
  it('入っているモデルの名前を返す', async () => {
    let path = ''
    const baseUrl = await startMockServer((request, _body, response) => {
      path = request.url ?? ''
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ models: [{ name: 'plamo:latest', model: 'plamo:latest' }, { name: 'llama3.1:8b' }, {}] }))
    })
    const models = await new OllamaBackend({ baseUrl, model: '' }).listModels()
    expect(path).toBe('/api/tags')
    expect(models).toEqual(['plamo:latest', 'llama3.1:8b'])
  })
})
