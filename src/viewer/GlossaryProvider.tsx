/**
 * 用語集を持ち、配下の画面の部品に渡す。
 */

import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { checkRows, loadGlossary, saveGlossary } from '../translate/glossary.ts'
import type { RowProblem } from '../translate/glossary.ts'
import type { GlossaryEntry } from '../translate/pfml3.ts'
import { GlossaryContext } from './glossaryContext.ts'

interface GlossaryState {
  rows: readonly GlossaryEntry[]
  entries: readonly GlossaryEntry[]
  problems: readonly (RowProblem | null)[]
}

function stateFor(rows: readonly GlossaryEntry[], previous?: GlossaryState): GlossaryState {
  const checked = checkRows(rows)
  // 入力の途中の行を編集しただけでは、翻訳に使う項目は変わらない。その場合は、前と同じ配列を渡し続ける。
  const unchanged = previous !== undefined && JSON.stringify(previous.entries) === JSON.stringify(checked.entries)
  return { rows, entries: unchanged ? previous.entries : checked.entries, problems: checked.problems }
}

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GlossaryState>(() => stateFor(loadGlossary()))

  const setRows = useCallback((rows: readonly GlossaryEntry[]) => {
    saveGlossary(rows)
    setState((previous) => stateFor(rows, previous))
  }, [])

  const value = useMemo(() => ({ ...state, setRows }), [state, setRows])
  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>
}
