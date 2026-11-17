/**
 * 用語集。原文の語と、その訳語の組を登録しておき、翻訳の依頼に付ける。
 *
 * 依頼には、登録した語のうち、その依頼の原文に出てくる語だけを付ける。理由は 2 つある。
 * - 原文に出てこない語を付けると、訳語は混ざらないものの、訳文の言い回しが変わることがあり、入力も長くなる
 *   (note/023_probe-glossary.md)。
 * - 訳文を保存する鍵は、依頼の文字列から作る(cache.ts)。出てくる語だけを付ければ、用語集を変えても、
 *   その語が出てこない段落の鍵は変わらず、保存した訳文をそのまま使える。
 *
 * 用語集は、ブラウザの localStorage に保存する。
 */

import type { GlossaryEntry } from './pfml3.ts'

/** 登録できる行の数の上限。 */
export const MAX_GLOSSARY_ROWS = 500
/** 語と訳語の、それぞれの長さの上限(文字数)。 */
export const MAX_TERM_LENGTH = 100
/**
 * 1 件の依頼に付ける項目の数の上限。1 項目は、入力を 7 から 12 トークンほど長くする(note/023_probe-glossary.md)。
 * 1 件の依頼で使える長さ(2,048 トークン)を、用語集が使い切らないようにする。
 */
export const MAX_ENTRIES_PER_REQUEST = 30

const STORAGE_KEY = 'glossary'

/** 語の区切りとみなす文字の並び。空白と、ハイフンの類(- ‐ ‑ –)。 */
const SEPARATOR = '[\\s\\-\\u2010\\u2011\\u2013]+'
const SEPARATOR_PATTERN = new RegExp(SEPARATOR, 'u')
/** 語を作る文字(文字と数字)。語の前後がこの文字の場合は、別の語の一部とみなす。 */
const WORD_CHARACTER = '[\\p{L}\\p{N}]'
/** 数式の目印。用語の一部にならないよう、照合の前に取り除く。 */
const MATH_TAG = /<\/?m\d+>/gi
/** 目印の代わりに置く文字。文字でも数字でも区切りでもないので、語の途中にも、語と語の間にも、当てはまらない。 */
const TAG_SUBSTITUTE = '\u0000'

/** 語を、区切りで分けた部分の並びにする。 */
function termParts(term: string): string[] {
  return term.split(SEPARATOR_PATTERN).filter((part) => part.length > 0)
}

/**
 * 大文字と小文字を区別して照合する語かどうか。
 * 語の 2 文字目以降に大文字がある語(RNN、ReLU、CLIP など)は、略語や固有の名前とみなして、区別する。
 * そうでない語(attention、Transformer など)は、文頭や見出しで大文字になるので、区別しない。
 */
export function isCaseSensitiveTerm(term: string): boolean {
  return termParts(term).some((part) => /^.+\p{Lu}/u.test(part))
}

/**
 * 同じ語かどうかを比べるための文字列。
 * 区切り(空白とハイフン)の違いと、前後の空白は無視する。大文字と小文字は、区別しない語でだけ無視する。
 */
export function termKey(term: string): string {
  const joined = termParts(term).join(' ')
  return isCaseSensitiveTerm(term) ? joined : joined.toLowerCase()
}

/**
 * 画面で編集している行が、翻訳に使われない理由。
 * - empty: 語も訳語も空(入力の前の行)
 * - no-source: 語が空、または、語に区切りの文字しか無い
 * - no-target: 訳語が空
 * - duplicate: 上の行と同じ語
 */
export type RowProblem = 'empty' | 'no-source' | 'no-target' | 'duplicate'

export interface CheckedGlossary {
  /** 翻訳に使う項目。前後の空白は取り除いてある。 */
  entries: GlossaryEntry[]
  /** 行ごとの、翻訳に使われない理由。使われる行は null。 */
  problems: (RowProblem | null)[]
}

/**
 * 画面で編集している行から、翻訳に使う項目を選ぶ。
 * 入力の途中の行(語や訳語が空の行)と、上の行と同じ語の行は、使わない。
 */
export function checkRows(rows: readonly GlossaryEntry[]): CheckedGlossary {
  const entries: GlossaryEntry[] = []
  const seen = new Set<string>()
  const problems = rows.map((row): RowProblem | null => {
    const source = row.source.trim().replace(/\s+/g, ' ')
    const target = row.target.trim()
    const key = termKey(source)
    if (source.length === 0 && target.length === 0) return 'empty'
    if (key.length === 0) return 'no-source'
    if (target.length === 0) return 'no-target'
    if (seen.has(key)) return 'duplicate'
    seen.add(key)
    entries.push({ source, target })
    return null
  })
  return { entries, problems }
}

/** 保存されていた値を、行の並びに直す。形の合わない要素は捨て、長すぎる文字列と多すぎる行は切り詰める。 */
export function normalizeRows(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return []
  const rows: GlossaryEntry[] = []
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const { source, target } = item as Record<string, unknown>
    if (typeof source !== 'string' || typeof target !== 'string') continue
    rows.push({ source: source.slice(0, MAX_TERM_LENGTH), target: target.slice(0, MAX_TERM_LENGTH) })
    if (rows.length >= MAX_GLOSSARY_ROWS) break
  }
  return rows
}

export function loadGlossary(): GlossaryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return normalizeRows(stored ? JSON.parse(stored) : null)
  } catch {
    return []
  }
}

export function saveGlossary(rows: readonly GlossaryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } catch {
    // 保存できない場合(プライベートウィンドウなど)は、今回の用語集だけを使う。
  }
}

/** 項目の並びを、画面に出す短い文字列にする。 */
export function describeEntries(entries: readonly GlossaryEntry[]): string {
  return entries.map((entry) => `${entry.source} → ${entry.target}`).join('、')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * 語の最後の部分に当てはまる正規表現を作る。英字で終わる部分は、複数形にも当てはまるようにする。
 * 当てはまる複数形は、語尾に s か es が付いた形(nets、losses)と、語尾の y が ies に変わった形(queries)。
 * 形が不規則に変わる複数形(matrices など)と、動詞の活用形には当てはまらない。
 */
function lastPartPattern(part: string): string {
  if (!/[A-Za-z]$/.test(part)) return escapeRegExp(part)
  if (/[yY]$/.test(part)) return `${escapeRegExp(part.slice(0, -1))}(?:${part.slice(-1)}(?:es|s)?|ies)`
  return `${escapeRegExp(part)}(?:es|s)?`
}

/** 原文の中の語に当てはまる正規表現を作る。当てはまるものが無い語(区切りの文字だけの語)は null。 */
function termPattern(term: string): RegExp | null {
  const parts = termParts(term)
  const last = parts.pop()
  if (last === undefined) return null
  const body = [...parts.map(escapeRegExp), lastPartPattern(last)].join(SEPARATOR)
  // 前後が文字や数字の場合は、別の語の一部なので、当てはめない(net は、network に当てはまらない)。
  return new RegExp(`(?<!${WORD_CHARACTER})(?:${body})(?!${WORD_CHARACTER})`, isCaseSensitiveTerm(term) ? 'gu' : 'giu')
}

interface CompiledEntry {
  entry: GlossaryEntry
  pattern: RegExp
  /** 登録した順番。 */
  order: number
  caseSensitive: boolean
  /** 語の長さ(区切りをそろえたあとの文字数)。 */
  length: number
}

/**
 * 原文に出てくる語の項目を選ぶ関数を作る。
 *
 * 返す関数は、原文を受け取り、その原文に出てくる語の項目を、原文に出てくる順に返す。
 * - 大文字と小文字は、略語のような語(isCaseSensitiveTerm)でだけ区別する。
 * - 語と語の間の空白とハイフンは、区別しない("self attention" は "self-attention" に当てはまる)。
 * - 複数形にも当てはまる("residual connection" は "residual connections" に当てはまる)。
 * - 長い語の一部としてしか出てこない短い語は、選ばない。"self-attention" と "attention" の両方を登録してあり、
 *   原文に "self-attention" しか無い場合は、"self-attention" の項目だけを返す。
 * - 項目の数は、MAX_ENTRIES_PER_REQUEST までとする。超える場合は、原文に先に出てくるものを残す。
 */
export function createGlossaryMatcher(entries: readonly GlossaryEntry[]): (source: string) => GlossaryEntry[] {
  const compiled: CompiledEntry[] = []
  entries.forEach((entry, order) => {
    const pattern = termPattern(entry.source)
    if (pattern) {
      compiled.push({ entry, pattern, order, caseSensitive: isCaseSensitiveTerm(entry.source), length: termKey(entry.source).length })
    }
  })
  // 長い語から先に、原文の中の位置を押さえる。同じ長さなら、大文字と小文字を区別する語を先にする。
  compiled.sort((a, b) => b.length - a.length || Number(b.caseSensitive) - Number(a.caseSensitive) || a.order - b.order)

  return (source) => {
    if (compiled.length === 0) return []
    const text = source.replace(MATH_TAG, TAG_SUBSTITUTE)
    /** すでに選んだ語が、原文の中で占める範囲。 */
    const taken: { start: number; end: number }[] = []
    const found: { entry: GlossaryEntry; position: number; order: number }[] = []
    for (const item of compiled) {
      const ranges: { start: number; end: number }[] = []
      for (const match of text.matchAll(item.pattern)) {
        const start = match.index
        const end = start + match[0].length
        // より長い語の一部になっている箇所は、数えない。
        if (!taken.some((range) => start >= range.start && end <= range.end)) ranges.push({ start, end })
      }
      const first = ranges[0]
      if (!first) continue
      taken.push(...ranges)
      found.push({ entry: item.entry, position: first.start, order: item.order })
    }
    return found
      .sort((a, b) => a.position - b.position || a.order - b.order)
      .slice(0, MAX_ENTRIES_PER_REQUEST)
      .map((item) => item.entry)
  }
}
