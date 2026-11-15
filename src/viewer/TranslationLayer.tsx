/**
 * 訳文を、元の段落の位置に重ねる層。
 *
 * 層の中の座標は、ページのポイントで書く。表示の倍率は、層全体を CSS で拡大縮小して合わせる。
 * そのため、倍率を変えても、訳文を収める計算はやり直さない。
 *
 * 訳文の中の数式の目印の位置には、元のページの描画から切り抜いた数式を置く。
 * 数式を組み直さないので、数式の見た目は原文と同じになる。
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MathPart, MathSlot } from '../analysis/source.ts'
import type { TranslationUnit } from '../analysis/units.ts'
import { splitByTags } from '../math/placeholders.ts'
import { fitText } from '../overlay/fit.ts'
import type { FitResult } from '../overlay/fit.ts'
import type { UnitState } from './session.ts'

/** 数式を切り抜くもとになる、ページの画像。 */
export interface PageImage {
  /** ページ全体を描画した画像の URL。まだ用意できていない場合は null。 */
  url: string | null
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
}

interface Props {
  units: readonly TranslationUnit[]
  translations: Readonly<Record<string, UnitState>>
  page: PageImage
  scale: number
  /** 原文の表示に切り替えている翻訳単位の名前。 */
  originals: ReadonlySet<string>
  onToggle: (unitId: string) => void
}

/** 原文の範囲に足す、行の上下の余白の分。文字の大きさに対する倍率。 */
const LINE_SLACK_EM = 0.35

/**
 * 数式の一部を、ページの画像から切り抜いて表示する。
 *
 * 長さは、原文の文字の大きさを 1 とする単位(em)で指定する。
 * 訳文の文字を小さくすると、数式も同じ割合で小さくなる。
 * 数式の下端は、原文での基準線からの距離の分だけ、訳文の基準線より下に置く。
 */
function spriteStyle(part: MathPart, fontSize: number, page: PageImage): CSSProperties {
  const em = (points: number) => `${points / fontSize}em`
  return {
    width: em(part.width),
    height: em(part.height),
    verticalAlign: em(part.baseline - (part.y + part.height)),
    backgroundImage: page.url ? `url("${page.url}")` : undefined,
    backgroundSize: `${em(page.width)} ${em(page.height)}`,
    backgroundPosition: `${em(-part.x)} ${em(-part.y)}`,
  }
}

interface BoxProps {
  unit: TranslationUnit
  state: UnitState
  page: PageImage
  onToggle: (unitId: string) => void
}

function TranslationBox({ unit, state, page, onToggle }: BoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<FitResult | null>(null)
  const singleLine = unit.lineCount === 1
  const centered = unit.kind === 'doc_title'

  const segments = useMemo(() => splitByTags(state.text), [state.text])
  const slots = useMemo(() => new Map<number, MathSlot>(unit.math.map((slot) => [slot.id, slot])), [unit])

  // 訳文が決まったら、収まる文字の大きさと行送りを、実際に組んで測って決める。
  // 数式の大きさは文字の大きさに比例するので、数式を含めた高さが測られる。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const slack = LINE_SLACK_EM * unit.fontSize
    const result = fitText(
      {
        fontSize: unit.fontSize,
        linePitch: unit.linePitch,
        // 原文の範囲は文字の上端から下端までで、行の上下の余白を含まない。
        // 同じ行数の訳文が「収まらない」と判定されないよう、余白の分を足す。
        height: unit.rect.height + slack,
        maxHeight: Math.max(unit.maxHeight, unit.rect.height + slack),
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
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          // 数式の前後の空白は、数式の側の余白で空ける。
          const before = segments[index - 1]?.type === 'math'
          const after = segments[index + 1]?.type === 'math'
          let text = segment.text
          if (before) text = text.replace(/^ +/, '')
          if (after) text = text.replace(/ +$/, '')
          return text
        }
        const slot = slots.get(segment.id)
        if (!slot) return null
        return slot.parts.map((part, partIndex) => (
          <span
            key={`${index}-${partIndex}`}
            className="math-sprite"
            title={slot.text}
            style={spriteStyle(part, unit.fontSize, page)}
          />
        ))
      })}
    </div>
  )
}

const MARKER_TITLES: Partial<Record<UnitState['status'], string>> = {
  kept: '訳文の中の数式の目印がそろわなかったため、原文のまま表示しています',
}

export function TranslationLayer({ units, translations, page, scale, originals, onToggle }: Props) {
  return (
    <div className="translation-layer" style={{ width: page.width, height: page.height, transform: `scale(${scale})` }}>
      {units.map((unit) => {
        const state = translations[unit.id]
        if (!state) return null
        const { x, y, width: w, height: h } = unit.rect
        if (state.status === 'done' && !originals.has(unit.id)) {
          return <TranslationBox key={unit.id} unit={unit} state={state} page={page} onToggle={onToggle} />
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

/** 元の文字を消す範囲(訳文を表示している段落)を、CSS の clip-path に渡す形で返す。 */
export function coverClipPath(
  units: readonly TranslationUnit[],
  translations: Readonly<Record<string, UnitState>>,
  originals: ReadonlySet<string>,
  scale: number,
): string | null {
  const parts: string[] = []
  for (const unit of units) {
    if (translations[unit.id]?.status !== 'done' || originals.has(unit.id)) continue
    const left = (unit.rect.x - COVER_PAD_X) * scale
    const top = (unit.rect.y - COVER_PAD_Y) * scale
    const right = (unit.rect.x + unit.rect.width + COVER_PAD_X) * scale
    const bottom = (unit.rect.y + unit.rect.height + COVER_PAD_Y) * scale
    parts.push(`M${left} ${top}H${right}V${bottom}H${left}Z`)
  }
  return parts.length > 0 ? `path('${parts.join('')}')` : null
}
