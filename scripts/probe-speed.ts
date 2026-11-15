/**
 * 実験 1: 生成速度の測定。
 *
 * 起動済みの llama-server に英語の段落を訳させ、同時依頼数ごとの生成速度を表にする。
 * モデルの大きさは、このスクリプトでは切り替えない。`npm run model -- 2b` などで起動した
 * サーバーに対して 1 回ずつ実行し、結果を比べる。
 *
 * 使い方:
 *   npm run probe:speed
 *   npm run probe:speed -- --concurrency 1,2,4 --paragraphs 20
 *   npm run probe:speed -- --base-url http://127.0.0.1:8089
 */

import { parseArgs } from 'node:util'
import { DEFAULT_LLAMA_SERVER_URL, LlamaServerBackend } from '../src/translate/llamaServer.ts'
import { MATH_SENTENCES } from './data/mathSentences.ts'
import { parsePositiveInteger, runMain } from './lib/cli.ts'
import { buildParagraphs } from './lib/paragraphs.ts'
import { mapWithConcurrency } from '../src/lib/pool.ts'
import { median, sum } from './lib/stats.ts'

interface Row {
  concurrency: number
  outputTokens: number
  seconds: number
  limitCount: number
  medianRequestSpeed: number | null
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: DEFAULT_LLAMA_SERVER_URL },
      concurrency: { type: 'string', default: '1,2,4' },
      paragraphs: { type: 'string', default: '20' },
      'sentences-per-paragraph': { type: 'string', default: '5' },
    },
  })

  const concurrencyLevels = values.concurrency
    .split(',')
    .map((level) => parsePositiveInteger(level.trim(), '--concurrency(カンマ区切りの各値)'))
  const paragraphCount = parsePositiveInteger(values.paragraphs, '--paragraphs')
  const sentencesPerParagraph = parsePositiveInteger(values['sentences-per-paragraph'], '--sentences-per-paragraph')

  const backend = new LlamaServerBackend({ baseUrl: values['base-url'] })
  const info = await backend.info()
  const paragraphs = buildParagraphs(MATH_SENTENCES, paragraphCount, sentencesPerParagraph)
  const sourceWords = sum(paragraphs.map((paragraph) => paragraph.split(/\s+/).length))

  console.log(`モデル: ${info.modelId}`)
  console.log(`サーバーの同時処理数: ${info.slots}、文脈の長さ: ${info.contextPerSlot ?? '不明'}`)
  console.log(`段落: ${paragraphs.length} 件(原文は合計 ${sourceWords} 語)`)
  console.log('')

  const rows: Row[] = []
  let sample = ''

  for (const concurrency of concurrencyLevels) {
    if (concurrency > info.slots) {
      console.log(`同時依頼数 ${concurrency} は、サーバーの同時処理数 ${info.slots} を超えるため省略します。`)
      continue
    }
    const started = performance.now()
    const results = await mapWithConcurrency(paragraphs, concurrency, (paragraph) =>
      backend.translate({ source: paragraph, sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 1024 }),
    )
    const seconds = (performance.now() - started) / 1000
    const speeds = results.map((result) => result.tokensPerSecond).filter((speed) => speed !== null)
    rows.push({
      concurrency,
      outputTokens: sum(results.map((result) => result.outputTokens ?? 0)),
      seconds,
      limitCount: results.filter((result) => result.stopReason === 'limit').length,
      medianRequestSpeed: speeds.length > 0 ? median(speeds) : null,
    })
    sample ||= results[0]?.text ?? ''
  }

  // 列の意味:
  //   全体の速度     = 生成したトークンの合計 ÷ かかった時間。同時に走る依頼を合わせた処理能力。
  //   1 依頼の速度   = 各依頼についてサーバーが報告した生成速度の中央値。
  //   1,000 トークン = 全体の速度で 1,000 トークンを生成するのにかかる秒数。
  //   上限で停止     = 生成の上限に達して訳文が途中で切れた依頼の数。
  console.log(
    '| 同時依頼数 | 生成トークン | 時間(秒) | 全体の速度(トークン毎秒) | 1 依頼の速度(トークン毎秒、中央値) | 1,000 トークンあたりの秒数 | 上限で停止 |',
  )
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const row of rows) {
    const overall = row.outputTokens / row.seconds
    console.log(
      `| ${row.concurrency} | ${row.outputTokens} | ${row.seconds.toFixed(1)} | ${overall.toFixed(1)} | ${
        row.medianRequestSpeed === null ? '不明' : row.medianRequestSpeed.toFixed(1)
      } | ${(1000 / overall).toFixed(1)} | ${row.limitCount} |`,
    )
  }

  console.log('')
  console.log('訳文の例(1 件目の段落):')
  console.log(sample)
}

await runMain(main)
