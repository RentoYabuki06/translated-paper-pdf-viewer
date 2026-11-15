/**
 * 解析結果をページの上に重ねて見せる、確認用の表示。
 * 文字のまとまり、数式と判定した文字、行、段落の範囲と、レイアウト検出の領域を、枠で示す。
 */

import { useMemo } from 'react'
import type { PageAnalysis } from '../analysis/analyzePage.ts'
import { actionFor, assignKind } from '../layout/assign.ts'
import type { LayoutRegion } from '../layout/types.ts'

export interface XRayOptions {
  runs: boolean
  math: boolean
  lines: boolean
  paragraphs: boolean
  regions: boolean
}

interface Props {
  analysis: PageAnalysis
  /** レイアウト検出の結果。検出していないページでは null。 */
  regions: LayoutRegion[] | null
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
  options: XRayOptions
}

/** 領域の名前を書く文字の大きさ(ポイント)。 */
const LABEL_SIZE = 7

export function XRayLayer({ analysis, regions, width, height, options }: Props) {
  const assignments = useMemo(
    () => (regions ? analysis.paragraphs.map((paragraph) => assignKind(paragraph, regions)) : null),
    [analysis, regions],
  )

  return (
    <svg className="xray" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {options.regions &&
        regions?.map((region, index) => (
          <g key={`g${index}`} className="xray-region">
            <rect x={region.x} y={region.y} width={region.width} height={region.height} />
            {/* 名前は、中の文字に重ならないよう、枠の上に書く。 */}
            <text x={region.x} y={Math.max(LABEL_SIZE, region.y - 1.5)} fontSize={LABEL_SIZE}>
              {`${region.order} ${region.label} ${region.score.toFixed(2)}`}
            </text>
          </g>
        ))}
      {options.paragraphs &&
        analysis.paragraphs.map((paragraph, index) => {
          const kind = assignments?.[index]?.kind
          // 検出の結果があるページでは、訳す段落と訳さない段落を、枠の種類で区別する。
          const className = kind === undefined ? 'xray-paragraph' : `xray-paragraph ${actionFor(kind)}`
          const kindText = kind === undefined ? '' : `、種類: ${kind}、${actionFor(kind) === 'translate' ? '訳す' : '訳さない'}`
          return (
            <rect
              key={`p${index}`}
              className={className}
              x={paragraph.x - 2}
              y={paragraph.y - 1}
              width={paragraph.width + 4}
              height={paragraph.height + 2}
            >
              <title>{`段落 ${index + 1}(${paragraph.lines.length} 行、${paragraph.fontSize} pt${kindText})\n${paragraph.text}`}</title>
            </rect>
          )
        })}
      {options.lines &&
        analysis.lines.map((line, index) => (
          <rect key={`l${index}`} className="xray-line" x={line.x} y={line.y} width={line.width} height={line.height} />
        ))}
      {options.runs &&
        analysis.runs.map((run, index) => (
          <rect key={`r${index}`} className="xray-run" x={run.x} y={run.y} width={run.width} height={run.height}>
            <title>{`${run.text}\n${run.fontName || '(フォント名なし)'} ${run.fontSize.toFixed(1)} pt`}</title>
          </rect>
        ))}
      {options.math &&
        analysis.runs
          .filter((run) => run.isMath)
          .map((run, index) => (
            <rect key={`m${index}`} className="xray-math" x={run.x} y={run.y} width={run.width} height={run.height}>
              <title>{`${run.text}\n${run.fontName || '(フォント名なし)'} ${run.fontSize.toFixed(1)} pt`}</title>
            </rect>
          ))}
    </svg>
  )
}
