/**
 * 訳文の中に置く数式の、表示の指定を作る。
 *
 * 数式は、元のページを描画した画像を背景にした要素で、背景の位置と大きさの指定によって、数式の範囲だけを見せる。
 */

import type { MathPart } from '../analysis/source.ts'

/** 数式を切り抜くもとになる、ページの画像。 */
export interface PageImage {
  /** ページ全体を描画した画像の URL。まだ用意できていない場合は null。 */
  url: string | null
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
}

/** 数式の要素に付ける CSS の指定。 */
export interface SpriteStyle {
  width: string
  height: string
  marginTop: string
  marginBottom: string
  verticalAlign: string
  backgroundImage: string | undefined
  backgroundSize: string
  backgroundPosition: string
}

/**
 * 数式が行の高さを広げずに済む範囲。基準線からの距離で、文字の大きさに対する倍率。
 * 訳文の文字の上端と下端に、行送りの余りの半分を足した値に当たる。
 */
const FREE_ABOVE_EM = 0.95
const FREE_BELOW_EM = 0.22
/**
 * 上の範囲からはみ出した分のうち、行の高さに数えない上限。文字の大きさに対する倍率。
 * 添字が少しはみ出すだけの数式で、行送りが広がらないようにする。原文の組版でも、添字は行送りを広げない。
 * 分数のように大きくはみ出す数式では、残りの分だけ行送りが広がる。
 */
const ABSORB_EM = 0.22

/**
 * 数式の一部を、ページの画像から切り抜いて表示する。
 *
 * 長さは、原文の文字の大きさを 1 とする単位(em)で指定する。
 * 訳文の文字を小さくすると、数式も同じ割合で小さくなる。
 * 数式の下端は、原文での基準線からの距離の分だけ、訳文の基準線より下に置く。
 */
export function spriteStyle(part: MathPart, fontSize: number, page: PageImage): SpriteStyle {
  const em = (points: number) => `${points / fontSize}em`
  const above = (part.baseline - part.y) / fontSize
  const below = (part.y + part.height - part.baseline) / fontSize
  // はみ出した分を、負の余白にして、行の高さの計算から外す。
  const absorbedAbove = Math.min(Math.max(above - FREE_ABOVE_EM, 0), ABSORB_EM)
  const absorbedBelow = Math.min(Math.max(below - FREE_BELOW_EM, 0), ABSORB_EM)
  return {
    width: em(part.width),
    height: em(part.height),
    marginTop: `${-absorbedAbove}em`,
    marginBottom: `${-absorbedBelow}em`,
    // 縦の位置は、余白を含めた下端で決まる。下の余白を削った分だけ、下端を上げておく。
    verticalAlign: `${absorbedBelow - below}em`,
    backgroundImage: page.url ? `url("${page.url}")` : undefined,
    backgroundSize: `${em(page.width)} ${em(page.height)}`,
    backgroundPosition: `${em(-part.x)} ${em(-part.y)}`,
  }
}
