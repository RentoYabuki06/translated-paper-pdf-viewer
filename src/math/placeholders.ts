/**
 * 文中の数式を表す目印(タグ)。
 *
 * 翻訳の前に、原文の中の数式を、番号だけの目印(<m1>、<m2>、…)に置き換える。
 * 訳文の中の目印の位置には、元のページから切り抜いた数式の画像を置く。
 * 番号だけの書式を選んだ理由は、note/013_inline-math.md に書いている。
 */

/** 番号 id の目印を作る。番号は 1 から始まる。 */
export function mathTag(id: number): string {
  return `<m${id}>`
}

const TAG = /<(\/?)m(\d+)>/g

/**
 * 訳文中の目印の表記ゆれを直す。
 * 全角の山括弧とスラッシュを半角にし、目印の内側の空白を取り除き、英字を小文字にそろえる。
 */
export function normalizeTags(text: string): string {
  return text
    .replace(/＜/g, '<')
    .replace(/＞/g, '>')
    .replace(/／/g, '/')
    .replace(/<\s*(\/?)\s*m\s*(\d+)\s*>/gi, '<$1m$2>')
}

/**
 * 本文の文字列が、目印として読まれないようにする。
 * "<m1>" の形の文字列が本文にあった場合に、"<" の直後にゼロ幅スペースを挟む。
 */
export function escapeTagLike(text: string): string {
  return text.replace(/<(?=\/?m\d+>)/gi, '<​')
}

/** 文字列の中の目印の番号を、現れた順に返す。 */
export function tagIds(text: string): number[] {
  return [...text.matchAll(TAG)].filter((match) => match[1] === '').map((match) => Number(match[2]))
}

export interface TagCheck {
  ok: boolean
  /**
   * 問題の一覧。形式は "m<番号>:<種類>"。種類は次のとおり。
   *   missing     目印が訳文に無い
   *   duplicated  目印が 2 回以上ある
   *   unknown     原文に無い番号の目印がある
   *   closing     閉じる側の形の目印(</m1>)がある
   */
  problems: string[]
}

/**
 * 訳文に、原文の目印がちょうど 1 回ずつ残っているかを検査する。
 * ids には、原文に含まれる目印の番号を渡す。訳文は、先に normalizeTags を通しておく。
 */
export function checkTags(translation: string, ids: readonly number[]): TagCheck {
  const expected = new Set(ids)
  const counts = new Map<number, number>()
  const problems: string[] = []
  const closing = new Set<number>()
  for (const match of translation.matchAll(TAG)) {
    const id = Number(match[2])
    if (match[1] === '/') closing.add(id)
    else counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const id of expected) {
    const count = counts.get(id) ?? 0
    if (count === 0) problems.push(`m${id}:missing`)
    if (count > 1) problems.push(`m${id}:duplicated`)
  }
  for (const id of counts.keys()) {
    if (!expected.has(id)) problems.push(`m${id}:unknown`)
  }
  for (const id of closing) problems.push(`m${id}:closing`)
  return { ok: problems.length === 0, problems }
}

export type Segment = { type: 'text'; text: string } | { type: 'math'; id: number }

/** 訳文を、文章の部分と、目印の部分に分ける。 */
export function splitByTags(text: string): Segment[] {
  const segments: Segment[] = []
  let position = 0
  for (const match of text.matchAll(TAG)) {
    if (match[1] === '/') continue
    if (match.index > position) segments.push({ type: 'text', text: text.slice(position, match.index) })
    segments.push({ type: 'math', id: Number(match[2]) })
    position = match.index + match[0].length
  }
  if (position < text.length) segments.push({ type: 'text', text: text.slice(position) })
  return segments
}
