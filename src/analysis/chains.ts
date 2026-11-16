/**
 * 段やページをまたいで続く段落を、1 つの翻訳単位につなぐ。
 *
 * 段落が段の下端で途切れ、次の段(または次のページ)の上端から続く場合、
 * 別々に訳すと、文の途中で切れた 2 つの訳文になる。
 * つないで 1 回で訳し、訳文を、もとの 2 つの範囲へ順に流し込む。
 */

import { mathTag } from '../math/placeholders.ts'
import type { MathSlot } from './source.ts'
import type { TranslationUnit } from './units.ts'

/** 文の終わりを示す記号で終わっているかどうか。記号のあとの、閉じる側の引用符と括弧は無視する。 */
const SENTENCE_END = /[.!?:;。]["'”’)\]]*\s*$/

/** 同じ大きさとみなす、文字の大きさの差の上限(割合)。 */
const FONT_SIZE_TOLERANCE = 0.05

/**
 * 段落 next が、段落 previous の続きかどうかを判定する。
 * previous は段のいちばん下、next は別の段(または次のページ)のいちばん上にあることを、呼び出し側で確かめておく。
 *
 * 続きとみなす条件は次のとおり。
 *   - どちらも本文(text)である
 *   - previous が、文の終わりの記号で終わっていない
 *   - previous の最後の行が、段の右端の近くまで届いている
 *   - next の 1 行目が字下げされていない
 *   - 文字の大きさが同じである
 */
export function continuesInto(previous: TranslationUnit, next: TranslationUnit): boolean {
  if (previous.kind !== 'text' || next.kind !== 'text') return false
  if (!previous.atColumnBottom || !next.atColumnTop) return false
  if (SENTENCE_END.test(previous.source)) return false
  if (!previous.lastLineFull) return false
  if (next.fragments[0]?.indented) return false
  if (Math.abs(previous.fontSize - next.fontSize) > FONT_SIZE_TOLERANCE * previous.fontSize) return false
  return true
}

/** 原文の中の目印の番号を、offset だけ後ろへずらす。 */
function shiftTags(source: string, offset: number): string {
  return source.replace(/<m(\d+)>/g, (_, id: string) => mathTag(Number(id) + offset))
}

/**
 * 2 つの翻訳単位をつなぐ。next の断片と数式を、previous の後ろに足す。
 *
 * 原文は、空白 1 つでつなぐ。行末のハイフンで分かれた語は、ハイフンを除いてつなぎ直す。
 * previous の終わりの数式と、next の始まりの数式は、またいで続く 1 つの数式として、1 つの目印にまとめる。
 */
export function joinUnits(previous: TranslationUnit, next: TranslationUnit): TranslationUnit {
  const math: MathSlot[] = previous.math.map((slot) => ({ ...slot, parts: [...slot.parts] }))
  let tail = next.source
  let nextSlots = next.math

  // 数式で終わり、数式で始まる場合は、next の最初の数式を、previous の最後の数式に足す。
  const last = math.at(-1)
  const first = nextSlots[0]
  if (last && first && previous.source.endsWith(mathTag(last.id)) && tail.startsWith(mathTag(first.id))) {
    last.parts.push(...first.parts)
    last.text += ` ${first.text}`
    tail = tail.slice(mathTag(first.id).length).trimStart()
    nextSlots = nextSlots.slice(1)
    // 残りの目印の番号を、1 つ前へ詰める。
    tail = shiftTags(tail, -1)
  }

  const offset = math.length
  for (const [index, slot] of nextSlots.entries()) math.push({ ...slot, id: offset + index + 1, parts: [...slot.parts] })
  tail = shiftTags(tail, offset)

  let source = previous.source.trimEnd()
  if (/[A-Za-z]-$/.test(source) && /^[a-z]/.test(tail)) source = source.slice(0, -1) + tail
  else source = tail.length > 0 ? `${source} ${tail}` : source

  return {
    ...previous,
    source,
    math,
    fragments: [...previous.fragments, ...next.fragments],
    atColumnBottom: next.atColumnBottom,
    lastLineFull: next.lastLineFull,
  }
}

/** 段落が別の段にあるかどうか。next の左端が、previous の右端の近くか、それより右にあれば、別の段とみなす。 */
function isNextColumn(previous: TranslationUnit, next: TranslationUnit): boolean {
  const from = previous.fragments.at(-1)
  const to = next.fragments[0]
  if (!from || !to) return false
  return to.rect.x >= from.rect.x + from.rect.width * 0.5
}

/** 続きの候補を選ぶ。同じページの右の段のいちばん上にある本文のうち、最も近い段のもの。 */
function nextColumnTop(unit: TranslationUnit, page: readonly TranslationUnit[]): TranslationUnit | undefined {
  let best: TranslationUnit | undefined
  for (const candidate of page) {
    if (candidate === unit || candidate.kind !== 'text' || !candidate.atColumnTop) continue
    if (!isNextColumn(unit, candidate)) continue
    if (!best || (candidate.fragments[0]?.rect.x ?? 0) < (best.fragments[0]?.rect.x ?? 0)) best = candidate
  }
  return best
}

/** 次のページの続きの候補を選ぶ。最も左の段のいちばん上にある本文。 */
function firstColumnTop(page: readonly TranslationUnit[]): TranslationUnit | undefined {
  let best: TranslationUnit | undefined
  for (const candidate of page) {
    if (candidate.kind !== 'text' || !candidate.atColumnTop) continue
    if (!best || (candidate.fragments[0]?.rect.x ?? 0) < (best.fragments[0]?.rect.x ?? 0)) best = candidate
  }
  return best
}

/** ページの中で、最も右の段にある翻訳単位かどうか。右に、別の段のいちばん上の本文が無ければ、最も右とみなす。 */
function isLastColumn(unit: TranslationUnit, page: readonly TranslationUnit[]): boolean {
  const rect = unit.fragments.at(-1)?.rect
  if (!rect) return false
  return !page.some((other) => {
    const otherRect = other.fragments[0]?.rect
    return other !== unit && FLOW_FOR_COLUMNS.has(other.kind) && otherRect !== undefined && otherRect.x >= rect.x + rect.width * 0.5
  })
}

/** 段の位置を調べるときに数える種類。本文と見出し。 */
const FLOW_FOR_COLUMNS: ReadonlySet<string> = new Set(['text', 'abstract', 'paragraph_title', 'doc_title'])

export interface LinkedPage {
  /** このページから始まる翻訳単位。段やページをまたぐ段落は、つないである。読む順に並ぶ。 */
  units: TranslationUnit[]
  /** 前のページの翻訳単位の続きとして取り込まれた、このページの翻訳単位の名前。 */
  absorbed: Set<string>
}

/** ページの中で、段をまたいで続く段落をつなぐ。返すのは、つないだあとの翻訳単位と、取り込まれた翻訳単位の名前。 */
function linkWithinPage(page: readonly TranslationUnit[]): { units: TranslationUnit[]; absorbed: Set<string> } {
  const absorbed = new Set<string>()
  const units: TranslationUnit[] = []
  for (const unit of page) {
    if (absorbed.has(unit.id)) continue
    let current = unit
    for (;;) {
      const next = nextColumnTop(current, page)
      if (!next || absorbed.has(next.id) || next.id === unit.id || !continuesInto(current, next)) break
      current = joinUnits(current, next)
      absorbed.add(next.id)
    }
    units.push(current)
  }
  return { units: units.filter((unit) => !absorbed.has(unit.id)), absorbed }
}

/**
 * 1 ページ分の翻訳単位を、前後のページとのつながりを含めて確定する。
 *
 * previous と next には、前後のページの翻訳単位(buildUnits の結果)を渡す。ページが無い場合は null を渡す。
 * ページをまたぐつながりは、1 つの翻訳単位につき 1 回までとする。
 */
export function linkPage(
  previous: readonly TranslationUnit[] | null,
  page: readonly TranslationUnit[],
  next: readonly TranslationUnit[] | null,
): LinkedPage {
  const within = linkWithinPage(page)
  const absorbed = new Set<string>()

  // 前のページの最後の段落が、このページの最初の段落へ続く場合、このページの段落は、前のページの翻訳単位に取り込まれる。
  if (previous) {
    const tail = linkWithinPage(previous).units.find((unit) => isLastColumn(unit, previous) && unit.atColumnBottom && unit.kind === 'text')
    const head = firstColumnTop(page)
    if (tail && head && continuesInto(tail, head)) absorbed.add(head.id)
  }

  const units = within.units
    .filter((unit) => !absorbed.has(unit.id))
    .map((unit) => {
      // このページの最後の段落が、次のページの最初の段落へ続く場合は、つなぐ。
      if (!next || unit.kind !== 'text' || !unit.atColumnBottom || !isLastColumn(unit, page)) return unit
      const head = firstColumnTop(next)
      return head && continuesInto(unit, head) ? joinUnits(unit, head) : unit
    })
  return { units, absorbed }
}
