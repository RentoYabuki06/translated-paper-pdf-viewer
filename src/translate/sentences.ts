/**
 * 英語の文章を、文に分ける。
 *
 * 数式の目印がそろわなかった段落を、文ごとに訳し直すために使う。
 * 分け方は簡単な規則によるもので、すべての文を正しく分けられるわけではない。
 * 分けそこなっても、訳し直しの単位が変わるだけで、文章が失われることはない。
 */

/** ピリオドで終わるが、文の終わりではないことが多い語。小文字で比べる。 */
const ABBREVIATIONS = new Set([
  'fig',
  'figs',
  'eq',
  'eqs',
  'eqn',
  'eqns',
  'sec',
  'secs',
  'tab',
  'ref',
  'refs',
  'def',
  'thm',
  'prop',
  'cor',
  'alg',
  'app',
  'ch',
  'no',
  'vol',
  'pp',
  'al',
  'e.g',
  'i.e',
  'cf',
  'vs',
  'etc',
  'resp',
  'approx',
  'w.r.t',
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'st',
])

/** 文の終わりの記号のあとに続いてよい、閉じる側の引用符と括弧。 */
const CLOSERS = /["'”’)\]]/

/** 次の文の始まりとみなす文字。大文字、数字、開く側の引用符と括弧、数式の目印。 */
const SENTENCE_START = /^(?:[A-Z0-9"'“‘(\[]|<m\d+>)/

/** 文に分ける。返す文をつなぐと、空白の違いを除いて、もとの文章になる。 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (char !== '.' && char !== '!' && char !== '?') continue

    // 記号のあとの、閉じる側の引用符と括弧を、同じ文に含める。
    let end = index + 1
    while (end < text.length && CLOSERS.test(text[end] as string)) end += 1
    if (end >= text.length || !/\s/.test(text[end] as string)) continue
    const rest = text.slice(end).trimStart()
    if (!SENTENCE_START.test(rest)) continue

    if (char === '.') {
      // ピリオドの直前の語が、略語か、1 文字の大文字(人名の頭文字)なら、文の終わりとしない。
      const word = /([A-Za-z][A-Za-z.]*)$/.exec(text.slice(start, index))?.[1] ?? ''
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^[A-Z]$/.test(word)) continue
    }

    sentences.push(text.slice(start, end).trim())
    start = end
    index = end - 1
  }
  const last = text.slice(start).trim()
  if (last.length > 0) sentences.push(last)
  return sentences
}
