/**
 * 訳文を、元の段落の範囲に収めるための計算。
 *
 * 次の順に試し、最初に収まったものを使う。
 *   1. 元の文字の大きさと行送りで、元の範囲に収まるか
 *   2. 下の空きへ箱を広げる
 *   3. 行送りを詰める
 *   4. 文字を段階的に小さくする(元の 67% まで。6 ポイント未満にはしない)
 * どれでも収まらない場合は、最も小さい設定で、末尾を隠す。
 *
 * 段やページをまたぐ段落(範囲が 2 つ以上ある訳文)では、前の範囲から順に訳文を詰めていき、
 * 最後の範囲に残りが収まるかどうかで、同じ順に試す。
 */

export type FitKind = 'original' | 'expanded' | 'tight' | 'shrunk' | 'clipped'

/** 訳文を入れる範囲 1 つ分の高さ。 */
export interface FlowBox {
  /** 元の範囲の高さ。 */
  height: number
  /** 箱を広げてよい高さの上限。最後の範囲でだけ使う。 */
  maxHeight: number
}

export interface FlowInput {
  /** 原文の文字の大きさ(ポイント)。 */
  fontSize: number
  /** 原文の行送り(ポイント)。 */
  linePitch: number
  /** 訳文を入れる範囲。読む順に並べる。 */
  boxes: readonly FlowBox[]
  /** 訳文の要素(1 文字、または数式 1 つ)の数。 */
  atomCount: number
}

export interface FitResult {
  kind: FitKind
  fontSize: number
  /** 行送り。文字の大きさに対する倍率。 */
  lineHeight: number
}

export interface FlowResult extends FitResult {
  /** 各範囲に入れる訳文の終わりの位置(その次の要素の番号)。最後の値は atomCount。 */
  breaks: number[]
}

/**
 * 訳文の一部を、指定した範囲の幅で組んだときの高さ(ポイント)を返す関数。
 * box は範囲の番号、start と end は訳文の要素の範囲(start 以上、end 未満)。
 */
export type FlowMeasure = (box: number, start: number, end: number, fontSize: number, lineHeight: number) => number

/** 詰めたときの行送り。日本語の文章が読める下限として決めた値。 */
export const TIGHT_LINE_HEIGHT = 1.2
/** 行送りの上限。原文の行送りが広い場合(見出しなど)に、訳文が間延びしないようにする。 */
const MAX_LINE_HEIGHT = 1.7
const SHRINK_STEPS = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.67]
const MIN_FONT_SIZE = 6
/** 高さの比較で許す誤差(ポイント)。 */
const TOLERANCE = 0.5

interface Candidate {
  kind: Exclude<FitKind, 'clipped'>
  fontSize: number
  lineHeight: number
  /** 最後の範囲を、下の空きへ広げてよいかどうか。 */
  expand: boolean
}

/** 試す設定を、試す順に並べる。 */
function candidates(fontSize: number, linePitch: number): Candidate[] {
  const natural = Math.min(MAX_LINE_HEIGHT, Math.max(TIGHT_LINE_HEIGHT, linePitch / fontSize))
  const list: Candidate[] = [
    { kind: 'original', fontSize, lineHeight: natural, expand: false },
    { kind: 'expanded', fontSize, lineHeight: natural, expand: true },
  ]
  if (natural > TIGHT_LINE_HEIGHT) list.push({ kind: 'tight', fontSize, lineHeight: TIGHT_LINE_HEIGHT, expand: true })
  let smallest = fontSize
  for (const step of SHRINK_STEPS) {
    const size = Math.max(MIN_FONT_SIZE, fontSize * step)
    if (size >= smallest) continue
    smallest = size
    list.push({ kind: 'shrunk', fontSize: size, lineHeight: TIGHT_LINE_HEIGHT, expand: true })
  }
  return list
}

/**
 * 訳文を、範囲に順に流し込む設定を探す。
 *
 * 最後の範囲を除く各範囲には、その高さに収まるだけの訳文を詰める。
 * canBreakBefore は、訳文をその位置の直前で分けてよいかどうかを返す関数。
 * 分けてはいけない位置(単語の途中や、句読点の直前)に当たった場合は、分ける位置を前へずらす。
 */
export function flowText(
  input: FlowInput,
  measure: FlowMeasure,
  canBreakBefore: (index: number) => boolean = () => true,
): FlowResult {
  const { boxes, atomCount } = input
  const lastIndex = boxes.length - 1
  const lastBox = boxes[lastIndex]
  if (!lastBox) throw new Error('訳文を入れる範囲がありません')

  let fallback: FlowResult | undefined
  for (const candidate of candidates(input.fontSize, input.linePitch)) {
    // 広げる余地が無い場合、「広げる」は「元のまま」と同じ結果になるので飛ばす。
    if (candidate.kind === 'expanded' && lastBox.maxHeight <= lastBox.height) continue
    const { fontSize, lineHeight } = candidate

    const breaks: number[] = []
    let start = 0
    for (let box = 0; box < lastIndex; box += 1) {
      const limit = (boxes[box] as FlowBox).height + TOLERANCE
      // 収まる最大の終わりの位置を、二分探索で求める。何も入れない場合は、必ず収まる。
      let low = start
      let high = atomCount
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (measure(box, start, middle, fontSize, lineHeight) <= limit) low = middle
        else high = middle - 1
      }
      let end = low
      if (end < atomCount) {
        let adjusted = end
        while (adjusted > start && !canBreakBefore(adjusted)) adjusted -= 1
        if (adjusted > start) end = adjusted
      }
      breaks.push(end)
      start = end
    }

    const height = start < atomCount ? measure(lastIndex, start, atomCount, fontSize, lineHeight) : 0
    const result: FlowResult = { kind: candidate.kind, fontSize, lineHeight, breaks: [...breaks, atomCount] }
    if (height <= (candidate.expand ? lastBox.maxHeight : lastBox.height) + TOLERANCE) return result
    fallback = result
  }
  return { ...(fallback as FlowResult), kind: 'clipped' }
}

export interface FitInput {
  /** 原文の文字の大きさ(ポイント)。 */
  fontSize: number
  /** 原文の行送り(ポイント)。 */
  linePitch: number
  /** 元の範囲の高さ。 */
  height: number
  /** 箱を広げてよい高さの上限。 */
  maxHeight: number
}

/**
 * 範囲が 1 つの訳文について、収まる設定を探す。
 * measure は、指定した文字の大きさと行送りで訳文を組んだときの高さ(ポイント)を返す関数。
 */
export function fitText(input: FitInput, measure: (fontSize: number, lineHeight: number) => number): FitResult {
  const { kind, fontSize, lineHeight } = flowText(
    {
      fontSize: input.fontSize,
      linePitch: input.linePitch,
      boxes: [{ height: input.height, maxHeight: input.maxHeight }],
      atomCount: 1,
    },
    (_box, _start, _end, size, height) => measure(size, height),
  )
  return { kind, fontSize, lineHeight }
}
