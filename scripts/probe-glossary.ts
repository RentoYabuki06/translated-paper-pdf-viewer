/**
 * 実験 5: 用語集の欄の効き方の確認。
 *
 * 訳語を指定したい語を含む英語の文章を、用語集を付けない場合と、付けた場合の 2 通りで訳させる。
 * 訳文に、指定した訳語が入っているか、避けたい訳語が残っていないかを、文字列の一致で調べる。
 * 結果は、語の出方の種類(複数形、略語、原文に出てこない語など)ごとに表にする。
 * 訳文として自然かどうかは、表示された訳文を読んで判断する。
 *
 * 使い方:
 *   npm run probe:glossary
 *   npm run probe:glossary -- --kinds basic,absent
 *   npm run probe:glossary -- --base-url http://127.0.0.1:8081
 *   npm run probe:glossary -- --ollama-model plamo-3-translate-2b
 */

import { parseArgs } from 'node:util'
import { checkTags, normalizeTags, tagIds } from '../src/math/placeholders.ts'
import type { TranslateRequest, TranslatorBackend } from '../src/translate/backend.ts'
import { DEFAULT_LLAMA_SERVER_URL, LlamaServerBackend } from '../src/translate/llamaServer.ts'
import { DEFAULT_OLLAMA_URL, OllamaBackend } from '../src/translate/ollama.ts'
import type { GlossaryEntry } from '../src/translate/pfml3.ts'
import { GLOSSARY_CASE_KINDS, GLOSSARY_CASES } from './data/glossaryCases.ts'
import type { GlossaryCase, GlossaryCaseKind } from './data/glossaryCases.ts'
import { runMain, UsageError } from './lib/cli.ts'
import { checkTerms, describeTermCheck } from './lib/terms.ts'
import type { TermCheck } from './lib/terms.ts'

const KIND_LABELS: Record<GlossaryCaseKind, string> = {
  basic: '登録した形のまま出てくる語',
  case: '大文字と小文字が違う語',
  inflected: '複数形や活用形',
  compound: '複合語の一部、表記の違い',
  acronym: '略語',
  keep: '英語のまま残す語',
  math: '数式の目印と一緒に出てくる語',
  overlap: '長い語と、その一部である短い語',
  long: '長い段落に何度も出てくる語',
  absent: '原文に出てこない語',
}

/** 一覧に、用語集の中身をすべて書く件数の上限。これより多い場合は、件数だけを書く。 */
const LISTED_ENTRIES = 5

function isKind(value: string): value is GlossaryCaseKind {
  return (GLOSSARY_CASE_KINDS as readonly string[]).includes(value)
}

interface Translation {
  text: string
  check: TermCheck
  tagsOk: boolean
  limited: boolean
  promptTokens: number | null
}

interface Outcome {
  item: GlossaryCase
  /** 用語集を付けない場合。 */
  plain: Translation
  /** 用語集を付けた場合。 */
  guided: Translation
}

function describeGlossary(glossary: readonly GlossaryEntry[]): string {
  if (glossary.length > LISTED_ENTRIES) return `${glossary.length} 件(${glossary[0]?.source} → ${glossary[0]?.target} など)`
  return glossary.map((entry) => `${entry.source} → ${entry.target}`).join('、')
}

async function translate(backend: TranslatorBackend, item: GlossaryCase, withGlossary: boolean): Promise<Translation> {
  const request: TranslateRequest = { source: item.text, sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 768 }
  if (withGlossary) request.glossary = item.glossary
  const result = await backend.translate(request)
  const text = normalizeTags(result.text)
  return {
    text,
    check: checkTerms(text, item.expect, item.avoid),
    tagsOk: checkTags(text, tagIds(item.text)).ok,
    limited: result.stopReason === 'limit',
    promptTokens: result.promptTokens,
  }
}

function marks(translation: Translation): string {
  return `${translation.tagsOk ? '' : ' [目印がそろわない]'}${translation.limited ? ' [上限で停止]' : ''}`
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: DEFAULT_LLAMA_SERVER_URL },
      'ollama-model': { type: 'string' },
      'ollama-url': { type: 'string', default: DEFAULT_OLLAMA_URL },
      kinds: { type: 'string', default: GLOSSARY_CASE_KINDS.join(',') },
    },
  })
  const kinds = values.kinds.split(',').map((name) => {
    const trimmed = name.trim()
    if (!isKind(trimmed)) throw new UsageError(`--kinds には ${GLOSSARY_CASE_KINDS.join('、')} のいずれかを指定してください: ${trimmed}`)
    return trimmed
  })
  const cases = GLOSSARY_CASES.filter((item) => kinds.includes(item.kind))

  const ollamaModel = values['ollama-model']
  const backend: TranslatorBackend =
    ollamaModel !== undefined
      ? new OllamaBackend({ baseUrl: values['ollama-url'], model: ollamaModel })
      : new LlamaServerBackend({ baseUrl: values['base-url'] })
  const info = await backend.info()
  console.log(
    ollamaModel !== undefined
      ? `依頼先: Ollama(${values['ollama-url']})。モデルの名前は ${info.modelId}`
      : `依頼先: llama-server(${values['base-url']})。モデルの名前は ${info.modelId}`,
  )
  console.log('')

  const outcomes: Outcome[] = []
  for (const [index, item] of cases.entries()) {
    // 依頼は 1 件ずつ送る。結果は、依頼の順番や同時に送る数によらない(毎回、最も確率の高いトークンを選ぶため)。
    const plain = await translate(backend, item, false)
    const guided = await translate(backend, item, true)
    outcomes.push({ item, plain, guided })

    console.log(`## ${index + 1}. ${item.kind}(${item.focus})`)
    console.log(`原文  : ${item.text}`)
    console.log(`用語集: ${describeGlossary(item.glossary)}`)
    console.log(`なし  : ${plain.text}${marks(plain)}`)
    console.log(`あり  : ${guided.text}${marks(guided)}`)
    const same = item.kind === 'absent' ? (plain.text === guided.text ? '。訳文は、用語集なしと同じ' : '。訳文は、用語集なしと違う') : ''
    console.log(`判定  : ${describeTermCheck(guided.check)}${same}(入力 ${plain.promptTokens ?? '不明'} → ${guided.promptTokens ?? '不明'} トークン)`)
    console.log('')
  }

  // 列の意味:
  //   用語集なしで指定どおり = 用語集を付けなくても、指定した訳語になっていた件数。
  //   用語集ありで指定どおり = 用語集を付けたときに、指定した訳語がすべて入り、避けたい訳語が残らなかった件数。
  //                            「原文に出てこない語」では、渡した訳語が訳文に混ざらなかった件数。
  //   目印がそろった件数     = 用語集を付けたときに、原文の数式の目印が、訳文にちょうど 1 回ずつ残った件数。
  console.log('| 語の出方 | 件数 | 用語集なしで指定どおり | 用語集ありで指定どおり | 目印がそろった件数 |')
  console.log('| --- | ---: | ---: | ---: | ---: |')
  for (const kind of kinds) {
    const rows = outcomes.filter((outcome) => outcome.item.kind === kind)
    if (rows.length === 0) continue
    console.log(
      `| ${KIND_LABELS[kind]}(${kind}) | ${rows.length} | ${kind === 'absent' ? '—' : rows.filter((row) => row.plain.check.ok).length} | ${
        rows.filter((row) => row.guided.check.ok).length
      } | ${rows.filter((row) => row.guided.tagsOk).length} |`,
    )
  }

  const absent = outcomes.filter((outcome) => outcome.item.kind === 'absent')
  if (absent.length > 0) {
    const unchanged = absent.filter((outcome) => outcome.plain.text === outcome.guided.text).length
    console.log('')
    console.log(`原文に出てこない語を渡した ${absent.length} 件のうち、訳文が用語集なしと同じだったのは ${unchanged} 件でした。`)
  }
  const present = outcomes.filter((outcome) => outcome.item.kind !== 'absent')
  if (present.length > 0) {
    console.log('')
    console.log(
      `原文に出てくる語を渡した ${present.length} 件のうち、指定どおりの訳文になったのは ${
        present.filter((outcome) => outcome.guided.check.ok).length
      } 件でした(用語集なしでは ${present.filter((outcome) => outcome.plain.check.ok).length} 件)。`,
    )
  }
}

await runMain(main)
