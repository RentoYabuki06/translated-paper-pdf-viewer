/**
 * ページ解析で使う型。
 *
 * 座標は、ページの左上を原点とし、右と下を正とする。
 * 単位は PDF のポイント(倍率 1 で描画したときの CSS ピクセルと同じ)。
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** PDF.js が返す文字のまとまり 1 つ。同じフォントで続けて書かれた文字列に当たる。 */
export interface TextRun extends Rect {
  text: string
  /** 文字の大きさ(ポイント)。 */
  fontSize: number
  /** PDF に書かれたフォントの名前(例: "ABCDEF+CMMI10")。取得できない場合は空文字列。 */
  fontName: string
  /** 文字の基準線(ベースライン)の y 座標。 */
  baseline: number
  /** 横書きの向きから回転している場合に true。行の組み立てには使わない。 */
  rotated: boolean
  /** 数式の文字と判定した場合に true。 */
  isMath: boolean
}

export interface Line extends Rect {
  /** 左から右の順に並べた文字のまとまり。 */
  runs: TextRun[]
  text: string
  /** 行の中で最も多く使われている文字の大きさ。 */
  fontSize: number
  baseline: number
  /** 行の文字のうち、数式の文字が占める割合(0 から 1)。 */
  mathRatio: number
}

export interface Paragraph extends Rect {
  /** 上から下の順に並べた行。 */
  lines: Line[]
  text: string
  fontSize: number
  mathRatio: number
}

export function unionRect(rects: readonly Rect[]): Rect {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}
