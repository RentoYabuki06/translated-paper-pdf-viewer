/**
 * 訳文を、元の段落の範囲に収めるための計算。
 *
 * 次の順に試し、最初に収まったものを使う。
 *   1. 元の文字の大きさと行送りで、元の範囲に収まるか
 *   2. 下の空きへ箱を広げる
 *   3. 行送りを詰める
 *   4. 文字を段階的に小さくする(元の 67% まで。6 ポイント未満にはしない)
 * どれでも収まらない場合は、最も小さい設定で、末尾を隠す。
 */

export type FitKind = 'original' | 'expanded' | 'tight' | 'shrunk' | 'clipped'

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

export interface FitResult {
  kind: FitKind
  fontSize: number
  /** 行送り。文字の大きさに対する倍率。 */
  lineHeight: number
}

/** 詰めたときの行送り。日本語の文章が読める下限として決めた値。 */
export const TIGHT_LINE_HEIGHT = 1.2
/** 行送りの上限。原文の行送りが広い場合(見出しなど)に、訳文が間延びしないようにする。 */
const MAX_LINE_HEIGHT = 1.7
const SHRINK_STEPS = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.67]
const MIN_FONT_SIZE = 6
/** 高さの比較で許す誤差(ポイント)。 */
const TOLERANCE = 0.5

/**
 * 収まる設定を探す。
 * measure は、指定した文字の大きさと行送りで訳文を組んだときの高さ(ポイント)を返す関数。
 */
export function fitText(input: FitInput, measure: (fontSize: number, lineHeight: number) => number): FitResult {
  const natural = Math.min(MAX_LINE_HEIGHT, Math.max(TIGHT_LINE_HEIGHT, input.linePitch / input.fontSize))
  const fits = (fontSize: number, lineHeight: number, limit: number) => measure(fontSize, lineHeight) <= limit + TOLERANCE

  if (fits(input.fontSize, natural, input.height)) {
    return { kind: 'original', fontSize: input.fontSize, lineHeight: natural }
  }
  if (input.maxHeight > input.height && fits(input.fontSize, natural, input.maxHeight)) {
    return { kind: 'expanded', fontSize: input.fontSize, lineHeight: natural }
  }
  if (natural > TIGHT_LINE_HEIGHT && fits(input.fontSize, TIGHT_LINE_HEIGHT, input.maxHeight)) {
    return { kind: 'tight', fontSize: input.fontSize, lineHeight: TIGHT_LINE_HEIGHT }
  }
  let smallest = input.fontSize
  for (const step of SHRINK_STEPS) {
    const fontSize = Math.max(MIN_FONT_SIZE, input.fontSize * step)
    if (fontSize >= smallest) continue
    smallest = fontSize
    if (fits(fontSize, TIGHT_LINE_HEIGHT, input.maxHeight)) {
      return { kind: 'shrunk', fontSize, lineHeight: TIGHT_LINE_HEIGHT }
    }
  }
  return { kind: 'clipped', fontSize: smallest, lineHeight: TIGHT_LINE_HEIGHT }
}
