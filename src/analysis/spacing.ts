/**
 * 文字の間のすき間の扱い。
 *
 * LaTeX で作った PDF は、単語の間に空白の文字を持たず、文字の位置をずらして空きを作る。
 * そのため、文字の間のすき間の大きさから、空白の有無を判定する。
 */

/**
 * 空白とみなすすき間の下限。文字の大きさに対する倍率。
 * PDF.js が文字を取り出すときに使う値(0.102)とほぼ同じにしている。
 */
export const SPACE_GAP_EM = 0.105

/** すき間が、空白に当たる大きさかどうか。fontSize には、隣り合う 2 文字のうち大きいほうの大きさを渡す。 */
export function isSpaceGap(gap: number, fontSize: number): boolean {
  return gap > SPACE_GAP_EM * fontSize
}
