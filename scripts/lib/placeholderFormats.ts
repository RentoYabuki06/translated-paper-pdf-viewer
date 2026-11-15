/**
 * 文中の数式を表す目印(タグ)の書式の候補と、訳文に目印が正しく残ったかの検査。
 *
 * 候補は 4 種類。実験の結果で 1 つを選び、アプリ本体に採用する。
 *
 *   bare        番号だけの目印。                      例: Let <m1> denote ...
 *   paired      数式の文字を包む、対の目印。          例: Let <m1>xi ∈ Rd</m1> denote ...
 *   bare+pin    bare に、用語集で「目印はそのまま残す」という指定を足したもの。
 *   paired+pin  paired に、同じ指定を足したもの。
 */

import type { GlossaryEntry } from '../../src/translate/pfml3.ts'
import type { MathSentence } from '../data/mathSentences.ts'
import { fillTemplate } from './paragraphs.ts'

export const PLACEHOLDER_FORMATS = ['bare', 'paired', 'bare+pin', 'paired+pin'] as const
export type PlaceholderFormat = (typeof PLACEHOLDER_FORMATS)[number]

export function isPlaceholderFormat(value: string): value is PlaceholderFormat {
  return (PLACEHOLDER_FORMATS as readonly string[]).includes(value)
}

function isPaired(format: PlaceholderFormat): boolean {
  return format === 'paired' || format === 'paired+pin'
}

function isPinned(format: PlaceholderFormat): boolean {
  return format === 'bare+pin' || format === 'paired+pin'
}

/** 数式の文字に含まれる山括弧を、目印と紛れない別の文字に置き換える。 */
function sanitizeMath(math: string): string {
  return math.replace(/</g, '‹').replace(/>/g, '›')
}

export interface EncodedSentence {
  /** 目印を埋め込んだ原文。 */
  source: string
  /** 「目印をそのまま残す」という用語集の指定。pin 付きの書式でだけ使う。 */
  glossary: GlossaryEntry[]
  /** 目印の数。番号は 1 から始まる。 */
  slotCount: number
}

/** 文中の数式を、指定の書式の目印に置き換える。 */
export function encodeSentence(sentence: MathSentence, format: PlaceholderFormat): EncodedSentence {
  const paired = isPaired(format)
  const replacements = sentence.math.map((math, index) => {
    const id = index + 1
    return paired ? `<m${id}>${sanitizeMath(math)}</m${id}>` : `<m${id}>`
  })

  const glossary: GlossaryEntry[] = []
  if (isPinned(format)) {
    for (let id = 1; id <= sentence.math.length; id += 1) {
      glossary.push({ source: `<m${id}>`, target: `<m${id}>` })
      if (paired) glossary.push({ source: `</m${id}>`, target: `</m${id}>` })
    }
  }

  return {
    source: fillTemplate(sentence.template, replacements),
    glossary,
    slotCount: sentence.math.length,
  }
}

// 表記ゆれを直す処理は、アプリ本体と共通のものを使う。
export { normalizeTags } from '../../src/math/placeholders.ts'

export interface CheckResult {
  ok: boolean
  /**
   * 問題の一覧。形式は "m<番号>:<種類>"。種類は次のとおり。
   *   missing           目印が訳文に無い
   *   duplicated        目印が 2 回以上ある
   *   unclosed          対の書式で、閉じる側の目印が無い
   *   duplicated-close  対の書式で、閉じる側の目印が 2 回以上ある
   *   order             対の書式で、閉じる側が開く側より前にある
   *   unexpected-close  番号だけの書式なのに、閉じる側の目印がある
   *   unknown           原文に無い番号の目印がある
   * これに加えて、対の書式で目印どうしが入れ子や交差になっている場合は "structure" が入る。
   */
  problems: string[]
}

interface TagToken {
  closing: boolean
  id: number
  index: number
}

/**
 * 訳文に、すべての目印がちょうど 1 回ずつ、正しい形で残っているかを検査する。
 * 表記ゆれを許す場合は、先に normalizeTags を通した訳文を渡す。
 */
export function checkTranslation(translation: string, slotCount: number, format: PlaceholderFormat): CheckResult {
  const paired = isPaired(format)
  const tokens: TagToken[] = [...translation.matchAll(/<(\/?)m(\d+)>/g)].map((match) => ({
    closing: match[1] === '/',
    id: Number(match[2]),
    index: match.index,
  }))
  const problems: string[] = []

  for (let id = 1; id <= slotCount; id += 1) {
    const opens = tokens.filter((token) => token.id === id && !token.closing)
    const closes = tokens.filter((token) => token.id === id && token.closing)

    if (opens.length === 0) problems.push(`m${id}:missing`)
    if (opens.length > 1) problems.push(`m${id}:duplicated`)

    if (paired) {
      if (closes.length === 0) problems.push(`m${id}:unclosed`)
      if (closes.length > 1) problems.push(`m${id}:duplicated-close`)
      const open = opens[0]
      const close = closes[0]
      if (opens.length === 1 && closes.length === 1 && open && close && close.index < open.index) {
        problems.push(`m${id}:order`)
      }
    } else if (closes.length > 0) {
      problems.push(`m${id}:unexpected-close`)
    }
  }

  const unknownIds = new Set(tokens.filter((token) => token.id < 1 || token.id > slotCount).map((token) => token.id))
  for (const id of unknownIds) problems.push(`m${id}:unknown`)

  // 対の書式では、目印が「開く、閉じる、開く、閉じる …」の順に並び、隣り合う組の番号が一致するはず。
  // ほかの問題が無いのにこの並びが崩れている場合は、入れ子か交差である。
  if (paired && problems.length === 0) {
    for (let i = 0; i < tokens.length; i += 2) {
      const open = tokens[i]
      const close = tokens[i + 1]
      if (!open || !close || open.closing || !close.closing || open.id !== close.id) {
        problems.push('structure')
        break
      }
    }
  }

  return { ok: problems.length === 0, problems }
}
