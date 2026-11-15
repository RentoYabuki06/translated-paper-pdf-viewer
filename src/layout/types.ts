/**
 * レイアウト検出(ページの画像から、段落・図・表などの領域を推定する処理)の型。
 */

import type { Rect } from '../analysis/types.ts'

/**
 * PP-DocLayoutV3 が区別する領域の種類。
 * 並びは、モデルの設定ファイル inference.yml の label_list と同じで、モデルが返す番号に対応する。
 */
export const LAYOUT_LABELS = [
  'abstract',
  'algorithm',
  'aside_text',
  'chart',
  'content',
  'display_formula',
  'doc_title',
  'figure_title',
  'footer',
  'footer_image',
  'footnote',
  'formula_number',
  'header',
  'header_image',
  'image',
  'inline_formula',
  'number',
  'paragraph_title',
  'reference',
  'reference_content',
  'seal',
  'table',
  'text',
  'vertical_text',
  'vision_footnote',
] as const

export type LayoutLabel = (typeof LAYOUT_LABELS)[number]

/** 検出された領域 1 つ。座標は、ページの左上を原点とするポイント。 */
export interface LayoutRegion extends Rect {
  label: LayoutLabel
  /** モデルが出した確からしさ(0 から 1)。 */
  score: number
  /** モデルが出した読む順番。小さいほど先。 */
  order: number
}

export type LayoutBackend = 'webgpu' | 'wasm'

export interface LayoutResult {
  regions: LayoutRegion[]
  /** 前処理から後処理までにかかった時間(ミリ秒)。 */
  milliseconds: number
}
