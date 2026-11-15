/**
 * 訳文を、元の段落の位置に重ねる層。
 *
 * 層の中の座標は、ページのポイントで書く。表示の倍率は、層全体を CSS で拡大縮小して合わせる。
 * そのため、倍率を変えても、訳文を収める計算はやり直さない。
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { TranslationUnit } from '../analysis/units.ts'
import { fitText } from '../overlay/fit.ts'
import type { FitResult } from '../overlay/fit.ts'
import type { UnitState } from './session.ts'

interface Props {
  units: readonly TranslationUnit[]
  translations: Readonly<Record<string, UnitState>>
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
  scale: number
  /** 原文の表示に切り替えている翻訳単位の名前。 */
  originals: ReadonlySet<string>
  onToggle: (unitId: string) => void
}

/** 原文の範囲に足す、行の上下の余白の分。文字の大きさに対する倍率。 */
const LINE_SLACK_EM = 0.35

interface BoxProps {
  unit: TranslationUnit
  state: UnitState
  onToggle: (unitId: string) => void
}

function TranslationBox({ unit, state, onToggle }: BoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<FitResult | null>(null)
  const singleLine = unit.lineCount === 1
  const centered = unit.kind === 'doc_title'

  // 訳文が決まったら、収まる文字の大きさと行送りを、実際に組んで測って決める。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const result = fitText(
      {
        fontSize: unit.fontSize,
        linePitch: unit.linePitch,
        // 原文の範囲は文字の上端から下端までで、行の上下の余白を含まない。
        // 同じ行数の訳文が「収まらない」と判定されないよう、余白の分を足す。
        height: unit.rect.height + LINE_SLACK_EM * unit.fontSize,
        maxHeight: Math.max(unit.maxHeight, unit.rect.height + LINE_SLACK_EM * unit.fontSize),
      },
      (fontSize, lineHeight) => {
        element.style.fontSize = `${fontSize}px`
        element.style.lineHeight = String(lineHeight)
        element.style.height = 'auto'
        return element.scrollHeight
      },
    )
    element.style.height = ''
    setFit(result)
  }, [unit, state.text])

  const clipped = fit?.kind === 'clipped'
  return (
    <div
      ref={ref}
      lang="ja"
      className={`translation ${unit.kind}${clipped ? ' clipped' : ''}${state.truncated ? ' truncated' : ''}`}
      data-fit={fit?.kind}
      title="クリックで原文を表示"
      onClick={() => onToggle(unit.id)}
      style={{
        left: unit.rect.x,
        top: unit.rect.y,
        // 1 行だけの段落(見出しなど)は、右の空きまで使ってよい。題名は、元の範囲の中央にそろえる。
        width: singleLine && !centered ? 'max-content' : unit.rect.width,
        maxWidth: singleLine && !centered ? unit.maxWidth : undefined,
        maxHeight: clipped ? unit.maxHeight : undefined,
        fontSize: fit?.fontSize ?? unit.fontSize,
        lineHeight: fit?.lineHeight,
        textIndent: unit.indented ? '1em' : undefined,
        textAlign: centered ? 'center' : undefined,
        visibility: fit ? 'visible' : 'hidden',
      }}
    >
      {state.text}
    </div>
  )
}

export function TranslationLayer({ units, translations, width, height, scale, originals, onToggle }: Props) {
  return (
    <div className="translation-layer" style={{ width, height, transform: `scale(${scale})` }}>
      {units.map((unit) => {
        const state = translations[unit.id]
        if (!state) return null
        const { x, y, width: w, height: h } = unit.rect
        if (state.status === 'done' && !originals.has(unit.id)) {
          return <TranslationBox key={unit.id} unit={unit} state={state} onToggle={onToggle} />
        }
        if (state.status === 'done') {
          return (
            <div
              key={unit.id}
              className="translation-marker original"
              title="クリックで訳文を表示"
              onClick={() => onToggle(unit.id)}
              style={{ left: x, top: y, width: w, height: h }}
            />
          )
        }
        return (
          <div
            key={unit.id}
            className={`translation-marker ${state.status}`}
            title={state.status === 'failed' ? `翻訳に失敗しました: ${state.error ?? ''}` : undefined}
            style={{ left: x, top: y, width: w, height: h }}
          />
        )
      })}
    </div>
  )
}

/** 元の文字を消す範囲(訳文を表示している段落)を、CSS の clip-path に渡す形で返す。 */
export function coverClipPath(
  units: readonly TranslationUnit[],
  translations: Readonly<Record<string, UnitState>>,
  originals: ReadonlySet<string>,
  scale: number,
): string | null {
  // 文字の上下のはみ出し(g や y の下の部分など)も消えるよう、範囲を少し広げる。
  const padX = 1
  const padY = 2
  const parts: string[] = []
  for (const unit of units) {
    if (translations[unit.id]?.status !== 'done' || originals.has(unit.id)) continue
    const left = (unit.rect.x - padX) * scale
    const top = (unit.rect.y - padY) * scale
    const right = (unit.rect.x + unit.rect.width + padX) * scale
    const bottom = (unit.rect.y + unit.rect.height + padY) * scale
    parts.push(`M${left} ${top}H${right}V${bottom}H${left}Z`)
  }
  return parts.length > 0 ? `path('${parts.join('')}')` : null
}
