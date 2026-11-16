import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkBackend } from '../../src/translate/connection.ts'
import { LlamaServerBackend } from '../../src/translate/llamaServer.ts'

let server: Server | undefined

/** 模擬サーバーを起動する。respond が false の場合は、接続を受け付けるが、応答を返さない。 */
async function startServer(respond: boolean): Promise<string> {
  const created = createServer((_request, response) => {
    if (!respond) return
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ total_slots: 4, model_alias: 'plamo-3-translate', default_generation_settings: { n_ctx: 2048 } }))
  })
  server = created
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(created.address() as AddressInfo).port}`
}

afterEach(async () => {
  const current = server
  server = undefined
  if (!current) return
  current.closeAllConnections()
  await new Promise<void>((resolve) => current.close(() => resolve()))
})

describe('checkBackend', () => {
  it('接続できた場合は、依頼先の情報を返す', async () => {
    const baseUrl = await startServer(true)
    const info = await checkBackend(new LlamaServerBackend({ baseUrl }), 'llama-server')
    expect(info).toEqual({ modelId: 'plamo-3-translate', slots: 4, contextPerSlot: 2048 })
  })

  it('応答が返らない場合は、待つ時間の上限で打ち切り、別のソフトの可能性を案内する', async () => {
    const baseUrl = await startServer(false)
    const started = Date.now()
    const error = await checkBackend(new LlamaServerBackend({ baseUrl }), `llama-server(${baseUrl})`, 200).catch((caught: unknown) => caught)
    expect(Date.now() - started).toBeLessThan(2000)
    expect((error as Error).message).toContain(`llama-server(${baseUrl}) から、0.2 秒待っても応答がありません`)
    expect((error as Error).message).toContain('別のソフト')
  })

  it('接続できない場合は、依頼先のエラーをそのまま伝える', async () => {
    const baseUrl = await startServer(true)
    const current = server
    server = undefined
    await new Promise<void>((resolve) => current?.close(() => resolve()))
    await expect(checkBackend(new LlamaServerBackend({ baseUrl }), 'llama-server')).rejects.toThrow('接続できません')
  })
})
