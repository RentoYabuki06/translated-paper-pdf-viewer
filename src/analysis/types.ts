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

/** まとまりの中の 1 文字。合字(fi など)は、1 文字が複数の文字の並びを持つ。 */
export interface RunChar {
  text: string
  /** 字形の原点の x 座標と、送り幅。 */
  x: number
  width: number
  /** PDF.js が読み込んだフォントの中で、この字形を指す文字。字形の大きさを測るときに使う。 */
  fontChar: string
}

/** 文字のまとまり 1 つ。同じフォント・同じ大きさ・同じ基準線で続けて書かれた文字の並びに当たる。 */
export interface TextRun extends Rect {
  /** まとまりの文字列。文字の間のすき間が空白に当たる箇所には、空白を補ってある。 */
  text: string
  chars: RunChar[]
  /** 文字の大きさ(ポイント)。 */
  fontSize: number
  /** PDF に書かれたフォントの名前(例: "ABCDEF+CMMI10")。取得できない場合は空文字列。 */
  fontName: string
  /** PDF.js が付けたフォントの名前(例: "g_d0_f1")。 */
  fontId: string
  /** 文字の基準線(ベースライン)の y 座標。 */
  baseline: number
  /** 横書きの向きから回転している場合に true。行の組み立てには使わない。 */
  rotated: boolean
  /** 数式用のフォントの文字、または数学記号だけの文字列と判定した場合に true。 */
  isMath: boolean
}

/** 行の中の 1 文字。 */
export interface LineChar extends RunChar {
  baseline: number
  fontSize: number
  fontName: string
  fontId: string
  /** フォントの情報から決めた、文字の上端と下端の y 座標。字形の実際の大きさとは異なることがある。 */
  top: number
  bottom: number
  /** 数式用のフォントの文字、または数学記号の場合に true。 */
  math: boolean
  /**
   * 行の上下に離れて置かれた数式の部品(分数の分母や、根号の中身など)の場合に true。
   * 行の基準線から外れているが、その行の数式の一部として扱う。
   */
  satellite: boolean
}

/** 行の中の数式 1 つ。chars の中の範囲(start 以上、end 未満)で表す。 */
export interface MathSpan {
  start: number
  end: number
}

export interface Line extends Rect {
  /** 左から右の順に並べた文字のまとまり。 */
  runs: TextRun[]
  /** 文字。まとまりの単位で左から右に並び、まとまりの中の順は PDF に書かれた順のまま。 */
  chars: LineChar[]
  /** 文中の数式。左から右の順で、互いに重ならない。 */
  spans: MathSpan[]
  /** 行の文章。数式も、PDF から読み取った文字のまま含む。 */
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
