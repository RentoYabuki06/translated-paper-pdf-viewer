/**
 * 実験 4: 依頼先どうしの訳文の比較。
 *
 * 同じ依頼を、複数の依頼先(llama-server や Ollama)に順に送り、訳文が一字一句同じかどうかを比べる。
 * 生成の設定は、最も確率の高いトークンを選び続けるものなので、同じ計算をしている依頼先は、同じ訳文を返す。
 * 訳文が違えば、依頼先の間で、計算のどこかが違っている。
 *
 * 入力は、実験用の文をつないだ段落で、文の数を変えて長さを変える。
 * 位置符号化の補正(scripts/lib/yarn.ts)の有無による違いは、短い入力では出ないことがある。
 *
 * 使い方:
 *   npm run probe:backends -- --llama http://127.0.0.1:8080 --ollama-model plamo-3-translate-2b
 *   npm run probe:backends -- --llama http://127.0.0.1:8080 --llama http://127.0.0.1:8082
 *   npm run probe:backends -- --llama http://127.0.0.1:8080 --ollama-model plamo-3-translate-2b --sentences 10,40
 */

import { parseArgs } from 'node:util'
import type { TranslateResult, TranslatorBackend } from '../src/translate/backend.ts'
import { LlamaServerBackend } from '../src/translate/llamaServer.ts'
import { DEFAULT_OLLAMA_URL, OllamaBackend } from '../src/translate/ollama.ts'
import { MATH_SENTENCES } from './data/mathSentences.ts'
import { parsePositiveInteger, runMain, UsageError } from './lib/cli.ts'
import { excerptAround, firstDifference } from './lib/compare.ts'
import { buildParagraphs } from './lib/paragraphs.ts'

interface Target {
  /** 表の中で依頼先を指す、短い名前(A、B、…)。 */
  label: string
  description: string
  backend: TranslatorBackend
}

interface Outcome {
  target: Target
  result: TranslateResult
  seconds: number
}

const LABELS = 'ABCDEFGH'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      llama: { type: 'string', multiple: true },
      'ollama-model': { type: 'string' },
      'ollama-url': { type: 'string', default: DEFAULT_OLLAMA_URL },
      sentences: { type: 'string', default: '5,10,20,30' },
    },
  })

  const candidates: { description: string; backend: TranslatorBackend }[] = (values.llama ?? []).map((url) => ({
    description: `llama-server(${url})`,
    backend: new LlamaServerBackend({ baseUrl: url }),
  }))
  const ollamaModel = values['ollama-model']
  if (ollamaModel !== undefined) {
    candidates.push({
      description: `Ollama(${values['ollama-url']}、モデル ${ollamaModel})`,
      backend: new OllamaBackend({ baseUrl: values['ollama-url'], model: ollamaModel }),
    })
  }
  if (candidates.length < 2 || candidates.length > LABELS.length) {
    throw new UsageError(
      [
        `比べる依頼先を、2 つ以上 ${LABELS.length} つ以下で指定してください。`,
        'llama-server は --llama <URL>(複数回の指定可)、Ollama は --ollama-model <モデルの名前> で指定します。',
        '例: npm run probe:backends -- --llama http://127.0.0.1:8080 --ollama-model plamo-3-translate-2b',
      ].join('\n'),
    )
  }
  const targets: Target[] = candidates.map((candidate, index) => ({ ...candidate, label: LABELS[index] as string }))
  const sentenceCounts = values.sentences
    .split(',')
    .map((count) => parsePositiveInteger(count.trim(), '--sentences(カンマ区切りの各値)'))

  console.log('依頼先:')
  for (const target of targets) {
    const info = await target.backend.info()
    console.log(`  ${target.label}: ${target.description}。モデルの名前は ${info.modelId}`)
  }

  // 最初の依頼には、モデルの読み込みの時間が入ることがある。時間を比べられるよう、先に短い依頼を 1 件ずつ送る。
  for (const target of targets) {
    await target.backend.translate({ source: 'This is a short sentence.', sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 64 })
  }

  let differingInputs = 0
  for (const sentenceCount of sentenceCounts) {
    const [paragraph] = buildParagraphs(MATH_SENTENCES, 1, sentenceCount)
    const outcomes: Outcome[] = []
    // 依頼は 1 件ずつ送る。同時に送ると、同じパソコンの上で計算の資源を取り合い、時間を比べられない。
    for (const target of targets) {
      const started = performance.now()
      const result = await target.backend.translate({
        source: paragraph as string,
        sourceLang: 'en',
        targetLang: 'ja',
        form: 'plain',
        maxTokens: 1024,
      })
      outcomes.push({ target, result, seconds: (performance.now() - started) / 1000 })
    }

    console.log('')
    console.log(`${sentenceCount} 文の入力:`)
    console.log('| 依頼先 | 入力トークン | 出力トークン | 時間(秒) | 速度(トークン毎秒) | 訳文の長さ(文字) | 上限で停止 |')
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const { target, result, seconds } of outcomes) {
      const speed = result.outputTokens !== null && seconds > 0 ? (result.outputTokens / seconds).toFixed(1) : '不明'
      console.log(
        `| ${target.label} | ${result.promptTokens ?? '不明'} | ${result.outputTokens ?? '不明'} | ${seconds.toFixed(1)} | ${speed} | ${
          result.text.length
        } | ${result.stopReason === 'limit' ? 'はい' : 'いいえ'} |`,
      )
    }

    let differs = false
    for (let i = 0; i < outcomes.length; i += 1) {
      for (let j = i + 1; j < outcomes.length; j += 1) {
        const first = outcomes[i] as Outcome
        const second = outcomes[j] as Outcome
        const position = firstDifference(first.result.text, second.result.text)
        if (position === null) {
          console.log(`${first.target.label} と ${second.target.label}: 訳文は同じ`)
          continue
        }
        differs = true
        console.log(`${first.target.label} と ${second.target.label}: 訳文が違う(${position + 1} 文字目から)`)
        console.log(`  ${first.target.label}: ${excerptAround(first.result.text, position)}`)
        console.log(`  ${second.target.label}: ${excerptAround(second.result.text, position)}`)
      }
    }
    if (differs) differingInputs += 1
  }

  console.log('')
  console.log(
    differingInputs === 0
      ? `${sentenceCounts.length} 通りの入力すべてで、どの依頼先の訳文も同じでした。`
      : `${sentenceCounts.length} 通りの入力のうち ${differingInputs} 通りで、訳文の違う依頼先がありました。`,
  )
}

await runMain(main)
