/**
 * 訳文を、元の段落の位置に重ねる層。
 *
 * 層の中の座標は、ページのポイントで書く。表示の倍率は、層全体を CSS で拡大縮小して合わせる。
 * そのため、倍率を変えても、訳文を収める計算はやり直さない。
 *
 * 訳文の中の数式の目印の位置には、元のページの描画から切り抜いた数式を置く。
 * 数式を組み直さないので、数式の見た目は原文と同じになる。
 *
 * 段やページをまたぐ段落の訳文は、複数の範囲(断片)に分けて表示する。
 * この層は、自分のページにある断片だけを表示する。分ける位置は、layout.ts が決める。
 */

import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TranslationUnit, UnitFragment } from '../analysis/units.ts'
import type { Atom } from '../overlay/atoms.ts'
import { layoutUnit, usesFreeWidth } from '../overlay/layout.ts'
import { spriteStyle } from '../overlay/sprite.ts'
import type { PageFragment, UnitState } from './session.ts'

interface Props {
  /** このページに表示する断片。 */
  fragments: readonly PageFragment[]
  translations: Readonly<Record<string, UnitState>>
  /** ページ番号ごとの、ページの画像の URL。数式を切り抜くもとになる。 */
  images: ReadonlyMap<number, string>
  /** ページの画像が要ることを伝える。 */
  requestImage: (pageNumber: number) => void
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
  scale: number
  /** 原文の表示に切り替えている翻訳単位の名前。 */
  originals: ReadonlySet<string>
  onToggle: (unitId: string) => void
}

interface BoxProps {
  unit: TranslationUnit
  index: number
  state: UnitState
  images: ReadonlyMap<number, string>
  requestImage: (pageNumber: number) => void
  pageWidth: number
  pageHeight: number
  onToggle: (unitId: string) => void
}

/** 訳文の単位の並びを、表示する要素にする。続く文字は、1 つの文字列にまとめる。 */
function renderAtoms(
  atoms: readonly Atom[],
  unit: TranslationUnit,
  images: ReadonlyMap<number, string>,
  pageWidth: number,
  pageHeight: number,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let text = ''
  atoms.forEach((atom, index) => {
    if (atom.type === 'char') {
      text += atom.text
      return
    }
    if (text.length > 0) {
      nodes.push(text)
      text = ''
    }
    // 数式は、その数式があるページの画像から切り抜く。訳文が表示されるページとは限らない。
    const page = { url: images.get(atom.part.pageNumber) ?? null, width: pageWidth, height: pageHeight }
    nodes.push(<span key={index} className="math-sprite" title={atom.title} style={spriteStyle(atom.part, unit.fontSize, page)} />)
  })
  if (text.length > 0) nodes.push(text)
  return nodes
}

/** 翻訳単位の断片 1 つ分の訳文。 */
function TranslationBox({ unit, index, state, images, requestImage, pageWidth, pageHeight, onToggle }: BoxProps) {
  const fragment = unit.fragments[index] as UnitFragment
  // 収まる文字の大きさと行送り、断片ごとの訳文の範囲。翻訳単位と訳文が同じなら、測り直さない。
  const layout = useMemo(() => layoutUnit(unit, state.text), [unit, state.text])
  const start = index === 0 ? 0 : (layout.breaks[index - 1] ?? 0)
  const end = layout.breaks[index] ?? layout.atoms.length
  const atoms = useMemo(() => {
    const slice = layout.atoms.slice(start, end)
    // 前の断片の続きは、空白で始めない。
    while (index > 0 && slice[0]?.type === 'char' && slice[0].text === ' ') slice.shift()
    return slice
  }, [layout, start, end, index])

  // この断片に出てくる数式の、もとのページの画像を用意してもらう。
  useEffect(() => {
    for (const atom of atoms) {
      if (atom.type === 'math') requestImage(atom.part.pageNumber)
    }
  }, [atoms, requestImage])

  if (atoms.length === 0) return null

  const last = index === unit.fragments.length - 1
  const free = usesFreeWidth(unit, fragment)
  const centered = unit.kind === 'doc_title'
  const clipped = layout.kind === 'clipped' && last
  return (
    <div
      lang="ja"
      className={`translation ${unit.kind}${clipped ? ' clipped' : ''}${state.truncated ? ' truncated' : ''}`}
      data-fit={layout.kind}
      data-unit={unit.id}
      data-fragment={`${index + 1}/${unit.fragments.length}`}
      data-retried={state.retried ? 'true' : undefined}
      title="クリックで原文を表示"
      onClick={() => onToggle(unit.id)}
      style={{
        left: fragment.rect.x,
        top: fragment.rect.y,
        // 1 行だけの段落(見出しなど)は、右の空きまで使ってよい。題名は、元の範囲の中央にそろえる。
        width: free ? 'max-content' : fragment.rect.width,
        maxWidth: free ? fragment.maxWidth : undefined,
        maxHeight: clipped ? fragment.maxHeight : undefined,
        fontSize: layout.fontSize,
        lineHeight: layout.lineHeight,
        textIndent: index === 0 && fragment.indented ? '1em' : undefined,
        textAlign: centered ? 'center' : undefined,
        // 次の断片へ続く場合は、最後の行も両端にそろえる。段落の途中の行だからである。
        textAlignLast: !last && end < layout.atoms.length ? 'justify' : undefined,
      }}
    >
      {renderAtoms(atoms, unit, images, pageWidth, pageHeight)}
    </div>
  )
}

const MARKER_TITLES: Partial<Record<UnitState['status'], string>> = {
  kept: '訳文の中の数式の目印がそろわなかったため、原文のまま表示しています',
}

export function TranslationLayer({ fragments, translations, images, requestImage, width, height, scale, originals, onToggle }: Props) {
  return (
    <div className="translation-layer" style={{ width, height, transform: `scale(${scale})` }}>
      {fragments.map(({ unit, index }) => {
        const state = translations[unit.id]
        if (!state) return null
        const key = `${unit.id}/${index}`
        const { x, y, width: w, height: h } = (unit.fragments[index] as UnitFragment).rect
        if (state.status === 'done' && !originals.has(unit.id)) {
          return (
            <TranslationBox
              key={key}
              unit={unit}
              index={index}
              state={state}
              images={images}
              requestImage={requestImage}
              pageWidth={width}
              pageHeight={height}
              onToggle={onToggle}
            />
          )
        }
        if (state.status === 'done') {
          return (
            <div
              key={key}
              className="translation-marker original"
              title="クリックで訳文を表示"
              onClick={() => onToggle(unit.id)}
              style={{ left: x, top: y, width: w, height: h }}
            />
          )
        }
        return (
          <div
            key={key}
            className={`translation-marker ${state.status}`}
            title={state.status === 'failed' ? `翻訳に失敗しました: ${state.error ?? ''}` : MARKER_TITLES[state.status]}
            style={{ left: x, top: y, width: w, height: h }}
          />
        )
      })}
    </div>
  )
}

/** 元の文字を消す範囲に足す余白(ポイント)。文字の上下のはみ出し(g や y の下の部分など)も消えるようにする。 */
export const COVER_PAD_X = 1
export const COVER_PAD_Y = 2

/** 元の文字を消す範囲(訳文を表示している断片)を、CSS の clip-path に渡す形で返す。 */
export function coverClipPath(
  fragments: readonly PageFragment[],
  translations: Readonly<Record<string, UnitState>>,
  originals: ReadonlySet<string>,
  scale: number,
): string | null {
  const parts: string[] = []
  for (const { unit, index } of fragments) {
    if (translations[unit.id]?.status !== 'done' || originals.has(unit.id)) continue
    const rect = (unit.fragments[index] as UnitFragment).rect
    const left = (rect.x - COVER_PAD_X) * scale
    const top = (rect.y - COVER_PAD_Y) * scale
    const right = (rect.x + rect.width + COVER_PAD_X) * scale
    const bottom = (rect.y + rect.height + COVER_PAD_Y) * scale
    parts.push(`M${left} ${top}H${right}V${bottom}H${left}Z`)
  }
  return parts.length > 0 ? `path('${parts.join('')}')` : null
}
