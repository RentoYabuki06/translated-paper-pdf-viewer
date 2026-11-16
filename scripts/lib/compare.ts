/**
 * 2 つの訳文を、1 文字ずつ比べるための部品。
 */

/**
 * 2 つの文字列が最初に違う位置(0 始まり)を返す。同じ文字列なら null を返す。
 * 片方が、もう片方の先頭の部分である場合は、短いほうの長さを返す。
 */
export function firstDifference(a: string, b: string): number | null {
  if (a === b) return null
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a[index] === b[index]) index += 1
  return index
}

/**
 * 文字列の、指定した位置の前後を切り出す。
 * 切り出した範囲が文字列の端に届いていない側には、「…」を付ける。
 */
export function excerptAround(text: string, index: number, before = 15, after = 40): string {
  const start = Math.max(0, index - before)
  const end = Math.min(text.length, index + after)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
