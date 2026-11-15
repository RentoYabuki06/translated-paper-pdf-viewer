/**
 * モデルの出力を、検出された領域の一覧に直す。
 *
 * PP-DocLayoutV3 の ONNX は、領域 1 つを 1 行とする表を返す。
 * 各行は [種類の番号, 確からしさ, 左, 上, 右, 下, 読む順番] の 7 つの数値である。
 * 座標は、入力の画像(800×800)の画素で受け取り、ここでページの座標(ポイント)に換算する。
 */

import { LAYOUT_LABELS } from './types.ts'
import type { LayoutRegion } from './types.ts'

/** 1 行あたりの数値の個数。 */
export const ROW_LENGTH = 7

/** 領域として採用する確からしさの下限。モデルの設定ファイル inference.yml の draw_threshold と同じ値。 */
export const DEFAULT_SCORE_THRESHOLD = 0.5

export interface ParseOptions {
  /** 表の数値。行ごとに ROW_LENGTH 個ずつ並ぶ。 */
  rows: ArrayLike<number>
  /** モデルに入力した画像の一辺(画素)。 */
  inputSize: number
  /** ページの大きさ(ポイント)。 */
  pageWidth: number
  pageHeight: number
  scoreThreshold?: number
}

export function parseRegions(options: ParseOptions): LayoutRegion[] {
  const { rows, inputSize, pageWidth, pageHeight } = options
  const threshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
  const scaleX = pageWidth / inputSize
  const scaleY = pageHeight / inputSize

  const regions: LayoutRegion[] = []
  for (let offset = 0; offset + ROW_LENGTH <= rows.length; offset += ROW_LENGTH) {
    const label = LAYOUT_LABELS[Math.round(rows[offset] as number)]
    const score = rows[offset + 1] as number
    if (label === undefined || !(score >= threshold)) continue

    const left = Math.max(0, Math.min(pageWidth, (rows[offset + 2] as number) * scaleX))
    const top = Math.max(0, Math.min(pageHeight, (rows[offset + 3] as number) * scaleY))
    const right = Math.max(0, Math.min(pageWidth, (rows[offset + 4] as number) * scaleX))
    const bottom = Math.max(0, Math.min(pageHeight, (rows[offset + 5] as number) * scaleY))
    if (right <= left || bottom <= top) continue

    regions.push({
      label,
      score,
      order: rows[offset + 6] as number,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    })
  }
  return regions.sort((a, b) => a.order - b.order)
}
