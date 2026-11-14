/**
 * llama-server の応答形式をまねる模擬サーバー。開発と動作確認のための道具。
 *
 * 実物のモデルは動かさない。依頼に含まれる原文を取り出し、先頭に「【訳】」を付けて、
 * 少しずつ送り返す。原文中の目印(タグ)はそのまま残る。
 * 速度の値は見かけ上のもので、実物の性能とは関係がない。
 *
 * 使い方:
 *   node scripts/mock-llama-server.ts              ポート 8089 で起動する
 *   node scripts/mock-llama-server.ts --port 9000  ポート番号を変える
 */

import { createServer } from 'node:http'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8089' },
    slots: { type: 'string', default: '4' },
    // 1 断片あたりの待ち時間(ミリ秒)。逐次表示の確認に使う。
    delay: { type: 'string', default: '5' },
    // N を指定すると、N 件に 1 件の依頼で、訳文から最初の目印を 1 つ落とす。失敗時の表示の確認に使う。
    'drop-every': { type: 'string', default: '0' },
  },
})
const port = Number(values.port)
const slots = Number(values.slots)
const delay = Number(values.delay)
const dropEvery = Number(values['drop-every'])
let completionCount = 0

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/** PFML3 の文字列から、今回訳す原文(最後の input 要素の本文)を取り出す。 */
function extractSource(prompt: string): string {
  const inputStart = prompt.lastIndexOf('<|plamo:tag|>input')
  if (inputStart === -1) return prompt
  const bodyStart = prompt.indexOf('<|plamo:msg|>', inputStart)
  const bodyEnd = prompt.indexOf('<|plamo:tag|>output', inputStart)
  if (bodyStart === -1 || bodyEnd === -1) return prompt
  return prompt.slice(bodyStart + '<|plamo:msg|>'.length, bodyEnd)
}

function chunksOf(text: string, size: number): string[] {
  const characters = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < characters.length; i += size) {
    chunks.push(characters.slice(i, i + size).join(''))
  }
  return chunks
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    void (async () => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, CORS)
        response.end()
        return
      }
      if (request.method === 'GET' && request.url === '/props') {
        response.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            total_slots: slots,
            model_alias: 'mock-llama-server',
            default_generation_settings: { n_ctx: 2048 * slots },
          }),
        )
        return
      }
      if (request.method === 'POST' && request.url === '/completion') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt?: string; n_predict?: number }
        completionCount += 1
        let translation = `【訳】${extractSource(body.prompt ?? '')}`
        if (dropEvery > 0 && completionCount % dropEvery === 0) {
          translation = translation.replace(/<m\d+>/, '')
        }
        const pieces = chunksOf(translation, 8)
        const limit = body.n_predict ?? pieces.length
        const sent = pieces.slice(0, limit)
        const started = performance.now()

        response.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream' })
        for (const piece of sent) {
          response.write(`data: ${JSON.stringify({ content: piece, stop: false })}\n\n`)
          await sleep(delay)
        }
        const seconds = Math.max((performance.now() - started) / 1000, 0.001)
        response.end(
          `data: ${JSON.stringify({
            content: '',
            stop: true,
            stop_type: sent.length < pieces.length ? 'limit' : 'eos',
            truncated: false,
            tokens_evaluated: Math.ceil((body.prompt ?? '').length / 4),
            tokens_predicted: sent.length,
            timings: { predicted_n: sent.length, predicted_per_second: sent.length / seconds },
          })}\n\n`,
        )
        return
      }
      response.writeHead(404, CORS)
      response.end()
    })()
  })
})

server.listen(port, '127.0.0.1', () => {
  console.error(`模擬サーバーを起動しました: http://127.0.0.1:${port}(同時処理数 ${slots})`)
})
