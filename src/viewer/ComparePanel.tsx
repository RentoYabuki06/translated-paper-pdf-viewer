/**
 * モデルごとの訳文を、段落ごとに横に並べて比べる画面。
 *
 * 保存してある訳文を並べる。翻訳の依頼はしない。
 * 基準にするモデルを 1 つ選ぶと、ほかのモデルの訳文のうち、基準の訳文には無い部分に色が付く。
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslationUnit } from '../analysis/units.ts'
import type { ParagraphKind } from '../layout/assign.ts'
import { markDifferences } from '../lib/textDiff.ts'
import { splitByTags } from '../math/placeholders.ts'
import { DEFAULT_MODEL_SIZE, DEFAULT_QUANT, modelAlias, shortModelLabel } from '../translate/models.ts'
import { duplicateColumns } from './compareColumns.ts'
import type { ComparisonRow } from './session.ts'

interface Props {
  /** 保存してある訳文が 1 件以上あったモデルの名前。rows の translations と同じ順。 */
  modelIds: readonly string[]
  rows: readonly ComparisonRow[]
  /** 保存してある訳文を、読み込み直す。 */
  onReload: () => void
  /** ページの表示に戻る。 */
  onClose: () => void
}

const KIND_LABELS: Partial<Record<ParagraphKind, string>> = {
  text: '本文',
  abstract: '要旨',
  doc_title: '題名',
  paragraph_title: '見出し',
  figure_title: '図表の説明',
  footnote: '脚注',
  vision_footnote: '図表の注',
}

/**
 * 数式の目印を含む文字列を、表示する要素にする。
 * 目印の位置には、PDF から読み取った数式の文字を、ほかの文字と区別できる見た目で置く。
 */
function renderTagged(text: string, unit: TranslationUnit, keyPrefix: string): ReactNode[] {
  return splitByTags(text).map((segment, index) =>
    segment.type === 'text' ? (
      segment.text
    ) : (
      <span key={`${keyPrefix}-${index}`} className="compare-math" title={`数式 ${segment.id}`}>
        {unit.math.find((slot) => slot.id === segment.id)?.text || `数式 ${segment.id}`}
      </span>
    ),
  )
}

/** 訳文を表示する要素にする。base を渡すと、base には無い部分に色を付ける。 */
function renderTranslation(text: string, base: string | null, unit: TranslationUnit): ReactNode[] {
  if (base === null) return renderTagged(text, unit, 'plain')
  return markDifferences(base, text).map((segment, index) =>
    segment.changed ? (
      <mark key={index} className="compare-diff">
        {renderTagged(segment.text, unit, `diff-${index}`)}
      </mark>
    ) : (
      <span key={index}>{renderTagged(segment.text, unit, `same-${index}`)}</span>
    ),
  )
}

export function ComparePanel({ modelIds, rows, onReload, onClose }: Props) {
  /** 訳文の列が、前にある別のモデルとすべて同じモデル。初めは表示しない。 */
  const duplicates = useMemo(() => duplicateColumns(modelIds, rows), [modelIds, rows])
  /** 表示しないモデルの名前。 */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(duplicateColumns(modelIds, rows).keys()))
  const defaultBaseline = modelAlias(DEFAULT_MODEL_SIZE, DEFAULT_QUANT)
  const [baseline, setBaseline] = useState<string>(modelIds.includes(defaultBaseline) ? defaultBaseline : (modelIds[0] ?? ''))
  const [onlyDifferent, setOnlyDifferent] = useState(false)

  /** 表示するモデルの、modelIds の中での番号。 */
  const shown = useMemo(
    () => modelIds.map((id, index) => ({ id, index })).filter(({ id }) => !hidden.has(id)),
    [modelIds, hidden],
  )
  // 基準にするモデルを隠した場合は、表示しているモデルの先頭を基準にする。
  const baselineIndex = shown.find(({ id }) => id === baseline)?.index ?? shown[0]?.index ?? -1

  /** 表示しているモデルの訳文が、すべてそろっていて、一字一句同じ行かどうか。 */
  const identical = useMemo(
    () =>
      rows.map((row) => {
        const texts = shown.map(({ index }) => row.translations[index] ?? null)
        return texts.length > 0 && texts.every((text) => text !== null && text === texts[0])
      }),
    [rows, shown],
  )
  const identicalCount = identical.filter((value) => value).length
  const visibleRows = rows.map((row, index) => ({ row, index })).filter(({ index }) => !onlyDifferent || identical[index] !== true)

  if (modelIds.length === 0) {
    return (
      <section className="panel compare">
        <p>この PDF には、保存してある訳文がありません。</p>
        <p className="status">
          比べたいモデルごとに、この PDF を 1 回ずつ翻訳しておきます。モデルは、llama-server を止めて、npm run model -- 8b
          のように起動し直すと替わります。
        </p>
        <div className="row">
          <button type="button" onClick={onReload}>
            読み込み直す
          </button>
          <button type="button" onClick={onClose}>
            ページの表示に戻る
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="panel compare">
      <div className="row">
        <strong>モデルごとの訳文</strong>
        <span className="toolbar-group">
          表示するモデル:
          {modelIds.map((id, index) => (
            <label key={id} title={id}>
              <input
                type="checkbox"
                checked={!hidden.has(id)}
                onChange={(event) => {
                  const next = new Set(hidden)
                  if (event.target.checked) next.delete(id)
                  else next.add(id)
                  setHidden(next)
                }}
              />
              {shortModelLabel(id)}({rows.filter((row) => row.translations[index] != null).length} / {rows.length} 段落
              {duplicates.has(id) && `、${shortModelLabel(duplicates.get(id) as string)} と同じ訳文`})
            </label>
          ))}
        </span>
        <label>
          基準にするモデル{' '}
          <select value={shown.some(({ id }) => id === baseline) ? baseline : (shown[0]?.id ?? '')} onChange={(event) => setBaseline(event.target.value)}>
            {shown.map(({ id }) => (
              <option key={id} value={id}>
                {shortModelLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyDifferent} onChange={(event) => setOnlyDifferent(event.target.checked)} />
          訳文に違いがある段落だけを表示
        </label>
        <button type="button" onClick={onReload}>
          読み込み直す
        </button>
        <button type="button" onClick={onClose}>
          ページの表示に戻る
        </button>
      </div>
      <p className="status" role="status">
        {rows.length} 段落のうち、表示しているモデルの訳文がすべて同じ段落は {identicalCount} 件です。色が付いているのは、基準にするモデルの訳文には無い部分です。保存してある訳文を並べていて、翻訳の依頼はしていません。
      </p>

      {/* 表の中だけを上下に送れるようにして、モデルの名前の行を、いつも見えるようにする。 */}
      <div className="compare-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col" className="position">
                位置
              </th>
              <th scope="col">原文</th>
              {shown.map(({ id }) => (
                <th key={id} scope="col" title={id}>
                  {shortModelLabel(id)}
                  {id === (shown.some((model) => model.id === baseline) ? baseline : shown[0]?.id) && <span className="status">(基準)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }) => {
              const { unit } = row
              const prefix = unit.prefix ? `${unit.prefix} ` : ''
              const base = baselineIndex >= 0 ? (row.translations[baselineIndex] ?? null) : null
              return (
                <tr key={unit.id} data-unit={unit.id} className={identical[index] ? 'identical' : undefined}>
                  <th scope="row" className="position">
                    {unit.pageNumber} ページ
                    <span className="status">{KIND_LABELS[unit.kind] ?? unit.kind}</span>
                  </th>
                  <td lang="en">
                    {prefix}
                    {renderTagged(unit.source, unit, 'source')}
                  </td>
                  {shown.map(({ id, index: modelIndex }) => {
                    const text = row.translations[modelIndex] ?? null
                    return (
                      <td key={id} lang="ja">
                        {text === null ? (
                          <span className="status">(保存してある訳文がありません)</span>
                        ) : (
                          <>
                            {prefix}
                            {renderTranslation(text, modelIndex === baselineIndex ? null : base, unit)}
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
