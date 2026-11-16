/**
 * 実験 3: 文脈の渡し方による訳文の違いの比較。
 *
 * 短い論文の形をした文章を、段落ごとに、文脈の渡し方を変えて訳させる。
 * 訳文を並べて表示し、数式の目印が残った数、入出力のトークン数、時間を、渡し方ごとに表にする。
 * 訳文の良し悪しは、表示された訳文を読んで判断する。
 *
 * 渡し方は次の 5 種類。
 *   none     文脈を渡さない。
 *   labeled  文脈の欄に、題名、節の見出し、直前の段落を、英語のラベルを付けて渡す。
 *   plain    文脈の欄に、同じ 3 つを、ラベルを付けずに渡す。
 *   history  履歴の欄に、直前の段落の原文と訳文の組を渡す。前の段落から順に訳す。
 *   both     文脈の欄に題名と節の見出しを、履歴の欄に直前の段落の原文と訳文の組を渡す。
 *
 * 使い方:
 *   npm run probe:context
 *   npm run probe:context -- --modes none,labeled
 *   npm run probe:context -- --base-url http://127.0.0.1:8081
 */

import { parseArgs } from 'node:util'
import { checkTags, normalizeTags, tagIds } from '../src/math/placeholders.ts'
import { sum } from '../src/lib/stats.ts'
import type { TranslateRequest } from '../src/translate/backend.ts'
import { DEFAULT_LLAMA_SERVER_URL, LlamaServerBackend } from '../src/translate/llamaServer.ts'
import { CONTEXT_PARAGRAPHS, CONTEXT_TITLE } from './data/contextParagraphs.ts'
import { runMain, UsageError } from './lib/cli.ts'

const MODES = ['none', 'labeled', 'plain', 'history', 'both'] as const
type Mode = (typeof MODES)[number]

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value)
}

interface Outcome {
  translation: string
  tagsOk: boolean
  limited: boolean
  promptTokens: number
  outputTokens: number
}

/** 段落ごとの、文脈のもとになる情報。 */
interface Surroundings {
  /** その段落が属する節の見出し。見出しそのものでは、空文字列。 */
  section: string
  /** 直前の本文の段落。無ければ空文字列。 */
  previous: string
}

function surroundingsOf(index: number): Surroundings {
  let section = ''
  let previous = ''
  for (const paragraph of CONTEXT_PARAGRAPHS.slice(0, index)) {
    if (paragraph.kind === 'heading') {
      section = paragraph.text
      previous = ''
    } else {
      previous = paragraph.text
    }
  }
  return { section, previous }
}

/** 文脈の欄に入れる文字列を作る。目印は、文脈の中では意味を持たないので、取り除く。 */
function contextFor(mode: 'labeled' | 'plain', surroundings: Surroundings): string {
  const previous = surroundings.previous.replace(/<m\d+>/g, '…')
  const parts =
    mode === 'labeled'
      ? [
          `Title: ${CONTEXT_TITLE}`,
          surroundings.section && `Section: ${surroundings.section}`,
          previous && `Previous paragraph: ${previous}`,
        ]
      : [CONTEXT_TITLE, surroundings.section, previous]
  return parts.filter((part) => part).join('\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: DEFAULT_LLAMA_SERVER_URL },
      modes: { type: 'string', default: MODES.join(',') },
    },
  })
  const modes = values.modes.split(',').map((name) => {
    const trimmed = name.trim()
    if (!isMode(trimmed)) throw new UsageError(`--modes には ${MODES.join('、')} のいずれかを指定してください: ${trimmed}`)
    return trimmed
  })

  const backend = new LlamaServerBackend({ baseUrl: values['base-url'] })
  const info = await backend.info()
  console.log(`モデル: ${info.modelId}`)
  console.log(`題名: ${CONTEXT_TITLE}`)
  console.log('')

  const outcomes = new Map<Mode, Outcome[]>()
  const seconds = new Map<Mode, number>()
  for (const mode of modes) {
    const started = performance.now()
    const results: Outcome[] = []
    for (const [index, paragraph] of CONTEXT_PARAGRAPHS.entries()) {
      const request: TranslateRequest = { source: paragraph.text, sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 512 }
      const surroundings = surroundingsOf(index)
      if (mode === 'labeled' || mode === 'plain') {
        request.context = contextFor(mode, surroundings)
      }
      if (mode === 'both') {
        request.context = contextFor('labeled', { ...surroundings, previous: '' })
      }
      if ((mode === 'history' || mode === 'both') && index > 0) {
        // 直前の項目(見出しを含む)の原文と、この渡し方で得た訳文を、履歴として渡す。
        const previous = CONTEXT_PARAGRAPHS[index - 1]
        const translated = results[index - 1]
        if (previous && translated) request.history = [{ source: previous.text, translation: translated.translation }]
      }
      const result = await backend.translate(request)
      const translation = normalizeTags(result.text)
      results.push({
        translation,
        tagsOk: checkTags(translation, tagIds(paragraph.text)).ok,
        limited: result.stopReason === 'limit',
        promptTokens: result.promptTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
      })
    }
    outcomes.set(mode, results)
    seconds.set(mode, (performance.now() - started) / 1000)
  }

  for (const [index, paragraph] of CONTEXT_PARAGRAPHS.entries()) {
    console.log(`## ${index + 1}. ${paragraph.kind === 'heading' ? '見出し' : '本文'}(${paragraph.focus})`)
    console.log(`原文: ${paragraph.text}`)
    for (const mode of modes) {
      const outcome = outcomes.get(mode)?.[index]
      if (!outcome) continue
      const marks = `${outcome.tagsOk ? '' : ' [目印がそろわない]'}${outcome.limited ? ' [上限で停止]' : ''}`
      console.log(`${mode.padEnd(8)}: ${outcome.translation}${marks}`)
    }
    console.log('')
  }

  // 列の意味:
  //   目印がそろった段落 = 原文の目印が、訳文にちょうど 1 回ずつ残った段落の数。
  //   訳文の文字数       = 訳文の文字数の合計。文脈の内容が訳文に混ざると、増える。
  console.log('| 渡し方 | 目印がそろった段落 | 訳文の文字数 | 入力トークン | 出力トークン | 時間(秒) |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const mode of modes) {
    const results = outcomes.get(mode) ?? []
    console.log(
      `| ${mode} | ${results.filter((outcome) => outcome.tagsOk).length} / ${results.length} | ${sum(
        results.map((outcome) => outcome.translation.length),
      )} | ${sum(results.map((outcome) => outcome.promptTokens))} | ${sum(results.map((outcome) => outcome.outputTokens))} | ${(
        seconds.get(mode) ?? 0
      ).toFixed(1)} |`,
    )
  }
}

await runMain(main)
