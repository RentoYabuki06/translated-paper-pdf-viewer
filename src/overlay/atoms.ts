/**
 * 訳文を、流し込みの単位(1 文字、または数式 1 つ)に分ける。
 *
 * 段やページをまたぐ段落の訳文は、複数の範囲に分けて表示する。
 * 分ける位置を決めるために、訳文を、これ以上分けない単位の並びとして扱う。
 */

import type { MathPart, MathSlot } from '../analysis/source.ts'
import { splitByTags } from '../math/placeholders.ts'

export type Atom =
  | { type: 'char'; text: string }
  /** 数式の一部。title は、PDF から読み取った数式の文字(マウスを重ねたときに表示する)。 */
  | { type: 'math'; part: MathPart; title: string }

/** 訳文を、単位の並びにする。数式の前後の空白は取り除く(数式の側の余白で空ける)。 */
export function buildAtoms(text: string, math: readonly MathSlot[]): Atom[] {
  const slots = new Map(math.map((slot) => [slot.id, slot]))
  const segments = splitByTags(text)
  const atoms: Atom[] = []
  segments.forEach((segment, index) => {
    if (segment.type === 'math') {
      const slot = slots.get(segment.id)
      for (const part of slot?.parts ?? []) atoms.push({ type: 'math', part, title: slot?.text ?? '' })
      return
    }
    let words = segment.text
    if (segments[index - 1]?.type === 'math') words = words.replace(/^ +/, '')
    if (segments[index + 1]?.type === 'math') words = words.replace(/ +$/, '')
    for (const char of words) atoms.push({ type: 'char', text: char })
  })
  return atoms
}

/** 行の先頭に置かない文字。句読点と、閉じる側の括弧。 */
const NO_LINE_START = new Set(Array.from('、。，．・：；！？）」』】〕〉》］｝,.:;!?)]}”’'))
/** 行の末尾に置かない文字。開く側の括弧。 */
const NO_LINE_END = new Set(Array.from('（「『【〔〈《［｛([{“‘'))
/** 英数字の語を作る文字。語の途中では分けない。 */
const WORD_CHAR = /^[A-Za-z0-9.,%\-]$/

/**
 * 訳文を、index 番目の単位の直前で分けてよいかどうか。
 * 句読点や閉じ括弧の直前、開き括弧の直後、英数字の語の途中では分けない。
 */
export function canBreakBefore(atoms: readonly Atom[], index: number): boolean {
  const previous = atoms[index - 1]
  const current = atoms[index]
  if (!previous || !current) return true
  if (current.type === 'char' && NO_LINE_START.has(current.text)) return false
  if (previous.type === 'char' && NO_LINE_END.has(previous.text)) return false
  if (previous.type === 'char' && current.type === 'char' && WORD_CHAR.test(previous.text) && WORD_CHAR.test(current.text)) {
    return false
  }
  return true
}
