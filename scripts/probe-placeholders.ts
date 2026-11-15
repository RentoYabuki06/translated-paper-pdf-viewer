/**
 * 実験 2: 数式の目印(タグ)が訳文に残る割合の測定。
 *
 * 数式を含む文を、目印の書式 4 種類のそれぞれで訳させる。
 * 訳文に「すべての目印がちょうど 1 回ずつ、正しい形で」残った文の割合を、書式ごとに表にする。
 *
 * 使い方:
 *   npm run probe:placeholders
 *   npm run probe:placeholders -- --formats bare,paired --limit 10
 *   npm run probe:placeholders -- --show-failures 20
 *   npm run probe:placeholders -- --base-url http://127.0.0.1:8089
 */

import { parseArgs } from 'node:util'
import { DEFAULT_LLAMA_SERVER_URL, LlamaServerBackend } from '../src/translate/llamaServer.ts'
import { MATH_SENTENCES } from './data/mathSentences.ts'
import { parsePositiveInteger, runMain, UsageError } from './lib/cli.ts'
import {
  checkTranslation,
  encodeSentence,
  isPlaceholderFormat,
  normalizeTags,
  PLACEHOLDER_FORMATS,
  type PlaceholderFormat,
} from './lib/placeholderFormats.ts'
import { mapWithConcurrency } from '../src/lib/pool.ts'
import { sum } from './lib/stats.ts'

interface Outcome {
  source: string
  translation: string
  slotCount: number
  /** 訳文をそのまま検査した結果。 */
  strictProblems: string[]
  /** 目印の表記ゆれ(全角、空白、大文字)を直してから検査した結果。 */
  looseProblems: string[]
  limited: boolean
}

function percent(count: number, total: number): string {
  return total === 0 ? '-' : `${((count / total) * 100).toFixed(1)}%`
}

/** "m3:missing" のような問題の一覧から、種類ごとの件数を数える。 */
function countProblemKinds(outcomes: readonly Outcome[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const outcome of outcomes) {
    for (const problem of outcome.strictProblems) {
      const kind = problem.includes(':') ? (problem.split(':')[1] as string) : problem
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
  }
  return counts
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: DEFAULT_LLAMA_SERVER_URL },
      formats: { type: 'string', default: PLACEHOLDER_FORMATS.join(',') },
      limit: { type: 'string', default: String(MATH_SENTENCES.length) },
      'show-failures': { type: 'string', default: '5' },
    },
  })

  const formats: PlaceholderFormat[] = values.formats.split(',').map((name) => {
    const trimmed = name.trim()
    if (!isPlaceholderFormat(trimmed)) {
      throw new UsageError(`--formats には ${PLACEHOLDER_FORMATS.join('、')} をカンマ区切りで指定してください: ${trimmed}`)
    }
    return trimmed
  })
  const limit = parsePositiveInteger(values.limit, '--limit')
  const showFailures = Number(values['show-failures'])
  if (!Number.isInteger(showFailures) || showFailures < 0) {
    throw new UsageError(`--show-failures には 0 以上の整数を指定してください: ${values['show-failures']}`)
  }

  const backend = new LlamaServerBackend({ baseUrl: values['base-url'] })
  const info = await backend.info()
  const sentences = MATH_SENTENCES.slice(0, limit)

  console.log(`モデル: ${info.modelId}`)
  console.log(`サーバーの同時処理数: ${info.slots}`)
  console.log(`文: ${sentences.length} 件(数式は合計 ${sum(sentences.map((sentence) => sentence.math.length))} か所)`)
  console.log('')

  const outcomesByFormat = new Map<PlaceholderFormat, Outcome[]>()
  for (const format of formats) {
    const outcomes = await mapWithConcurrency(sentences, info.slots, async (sentence): Promise<Outcome> => {
      const encoded = encodeSentence(sentence, format)
      const result = await backend.translate({
        source: encoded.source,
        sourceLang: 'en',
        targetLang: 'ja',
        form: 'plain',
        glossary: encoded.glossary,
        maxTokens: 512,
      })
      return {
        source: encoded.source,
        translation: result.text,
        slotCount: encoded.slotCount,
        strictProblems: checkTranslation(result.text, encoded.slotCount, format).problems,
        looseProblems: checkTranslation(normalizeTags(result.text), encoded.slotCount, format).problems,
        limited: result.stopReason === 'limit',
      }
    })
    outcomesByFormat.set(format, outcomes)
  }

  // 列の意味:
  //   厳密に合格       = 訳文をそのまま検査して、すべての目印がちょうど 1 回ずつ正しい形で残った文。
  //   表記を直して合格 = 目印の表記ゆれ(全角の括弧、内側の空白、大文字)を直してから検査して合格した文。
  //   上限で停止       = 生成の上限に達して訳文が途中で切れた文。
  console.log('| 書式 | 文の数 | 厳密に合格 | 表記を直して合格 | 上限で停止 |')
  console.log('| --- | ---: | ---: | ---: | ---: |')
  for (const [format, outcomes] of outcomesByFormat) {
    const total = outcomes.length
    const strict = outcomes.filter((outcome) => outcome.strictProblems.length === 0).length
    const loose = outcomes.filter((outcome) => outcome.looseProblems.length === 0).length
    const limited = outcomes.filter((outcome) => outcome.limited).length
    console.log(
      `| ${format} | ${total} | ${strict}(${percent(strict, total)}) | ${loose}(${percent(loose, total)}) | ${limited} |`,
    )
  }

  for (const [format, outcomes] of outcomesByFormat) {
    const failures = outcomes.filter((outcome) => outcome.strictProblems.length > 0)
    if (failures.length === 0) continue

    console.log('')
    const kinds = [...countProblemKinds(outcomes)].map(([kind, count]) => `${kind} ${count} 件`).join('、')
    console.log(`## ${format}: 厳密な検査で不合格の文 ${failures.length} 件(問題の内訳: ${kinds})`)
    for (const failure of failures.slice(0, showFailures)) {
      console.log('')
      console.log(`原文: ${failure.source}`)
      console.log(`訳文: ${failure.translation}`)
      console.log(`問題: ${failure.strictProblems.join(', ')}`)
    }
    if (failures.length > showFailures) {
      console.log('')
      console.log(`(残り ${failures.length - showFailures} 件は省略。--show-failures で表示数を変えられます)`)
    }
  }
}

await runMain(main)
