/**
 * 用語集を、画面の部品の間で共有するための入れ物。
 * 中身を用意する部品は GlossaryProvider.tsx にある。
 */

import { createContext, useContext } from 'react'
import type { RowProblem } from '../translate/glossary.ts'
import type { GlossaryEntry } from '../translate/pfml3.ts'

export interface GlossaryContextValue {
  /** 画面で編集している行。入力の途中の行(語や訳語が空の行)も含む。 */
  rows: readonly GlossaryEntry[]
  /** 行を置き換える。置き換えた行は保存される。 */
  setRows: (rows: readonly GlossaryEntry[]) => void
  /** 翻訳に使う項目。rows のうち、語と訳語がそろっていて、上の行と重複しないもの。内容が変わるまで、同じ配列を返す。 */
  entries: readonly GlossaryEntry[]
  /** 行ごとの、翻訳に使われない理由。使われる行は null。 */
  problems: readonly (RowProblem | null)[]
}

export const GlossaryContext = createContext<GlossaryContextValue | null>(null)

export function useGlossary(): GlossaryContextValue {
  const value = useContext(GlossaryContext)
  if (!value) throw new Error('GlossaryProvider の外で useGlossary が呼ばれました')
  return value
}
