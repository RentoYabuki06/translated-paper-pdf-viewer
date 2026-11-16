/**
 * 訳文を、翻訳単位の範囲(断片)に収める設定を決める。ブラウザでだけ使える。
 *
 * 画面に出ている訳文の箱とは別に、見えない場所に測定用の箱を作り、そこで訳文を組んで高さを測る。
 * 段やページをまたぐ段落では、断片が別々のページにある。
 * 片方のページが画面に出ていなくても分ける位置を決められるよう、表示とは切り離して測る。
 */

import type { TranslationUnit, UnitFragment } from '../analysis/units.ts'
import { buildAtoms, canBreakBefore } from './atoms.ts'
import type { Atom } from './atoms.ts'
import { flowText } from './fit.ts'
import type { FlowResult } from './fit.ts'
import { spriteStyle } from './sprite.ts'

export interface UnitLayout extends FlowResult {
  /** 訳文の単位(1 文字、または数式 1 つ)の並び。 */
  atoms: Atom[]
}

/** 原文の範囲に足す、行の上下の余白の分。文字の大きさに対する倍率。 */
const LINE_SLACK_EM = 0.35

/** 1 行だけの段落(見出しなど)は、右の空きまで幅を使ってよい。題名は、元の範囲の中央にそろえるので、幅を変えない。 */
export function usesFreeWidth(unit: TranslationUnit, fragment: UnitFragment): boolean {
  return unit.fragments.length === 1 && fragment.lineCount === 1 && unit.kind !== 'doc_title'
}

let measurer: HTMLDivElement | undefined

/** 測定用の箱を返す。最初に呼ばれたときに作る。 */
function getMeasurer(): HTMLDivElement {
  if (!measurer) {
    const host = document.createElement('div')
    host.className = 'translation-measurer'
    host.setAttribute('aria-hidden', 'true')
    measurer = document.createElement('div')
    host.append(measurer)
    document.body.append(host)
  }
  return measurer
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 単位を、測定用の HTML にする。数式は、大きさと位置だけを指定した空の要素にする。 */
function atomHtml(atom: Atom, fontSize: number): string {
  if (atom.type === 'char') return escapeHtml(atom.text)
  const style = spriteStyle(atom.part, fontSize, { url: null, width: 0, height: 0 })
  return `<span class="math-sprite" style="width:${style.width};height:${style.height};margin-top:${style.marginTop};margin-bottom:${style.marginBottom};vertical-align:${style.verticalAlign}"></span>`
}

const cache = new WeakMap<TranslationUnit, Map<string, UnitLayout>>()

/**
 * 訳文を、翻訳単位の断片に収める設定(文字の大きさ、行送り、断片ごとの訳文の範囲)を決める。
 * 同じ翻訳単位と訳文の組み合わせは、2 回目以降は測り直さない。
 */
export function layoutUnit(unit: TranslationUnit, text: string): UnitLayout {
  let perUnit = cache.get(unit)
  if (!perUnit) {
    perUnit = new Map()
    cache.set(unit, perUnit)
  }
  const cached = perUnit.get(text)
  if (cached) return cached

  // 節の見出しの番号は、訳文の前に、そのまま付ける。
  const atoms = buildAtoms(unit.prefix ? `${unit.prefix} ${text}` : text, unit.math)
  const html = atoms.map((atom) => atomHtml(atom, unit.fontSize))
  const element = getMeasurer()
  element.className = `translation ${unit.kind}`
  const slack = LINE_SLACK_EM * unit.fontSize

  const flow = flowText(
    {
      fontSize: unit.fontSize,
      linePitch: unit.linePitch,
      atomCount: atoms.length,
      // 原文の範囲は文字の上端から下端までで、行の上下の余白を含まない。
      // 同じ行数の訳文が「収まらない」と判定されないよう、余白の分を足す。
      boxes: unit.fragments.map((fragment) => ({
        height: fragment.rect.height + slack,
        maxHeight: Math.max(fragment.maxHeight, fragment.rect.height + slack),
      })),
    },
    (box, start, end, fontSize, lineHeight) => {
      const fragment = unit.fragments[box] as UnitFragment
      const free = usesFreeWidth(unit, fragment)
      element.style.width = free ? 'max-content' : `${fragment.rect.width}px`
      element.style.maxWidth = free ? `${fragment.maxWidth}px` : ''
      element.style.fontSize = `${fontSize}px`
      element.style.lineHeight = String(lineHeight)
      element.style.textIndent = box === 0 && fragment.indented ? '1em' : '0'
      element.innerHTML = html.slice(start, end).join('')
      return element.scrollHeight
    },
    (index) => canBreakBefore(atoms, index),
  )
  element.innerHTML = ''

  const layout: UnitLayout = { ...flow, atoms }
  perUnit.set(text, layout)
  return layout
}
