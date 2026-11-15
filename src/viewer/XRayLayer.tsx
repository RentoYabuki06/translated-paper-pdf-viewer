/**
 * 解析結果をページの上に重ねて見せる、確認用の表示。
 * 文字のまとまり、数式と判定した文字、行、段落の範囲を、枠で示す。
 */

import type { PageAnalysis } from '../analysis/analyzePage.ts'

export interface XRayOptions {
  runs: boolean
  math: boolean
  lines: boolean
  paragraphs: boolean
}

interface Props {
  analysis: PageAnalysis
  /** ページの大きさ(ポイント)。 */
  width: number
  height: number
  options: XRayOptions
}

export function XRayLayer({ analysis, width, height, options }: Props) {
  return (
    <svg className="xray" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {options.paragraphs &&
        analysis.paragraphs.map((paragraph, index) => (
          <rect
            key={`p${index}`}
            className="xray-paragraph"
            x={paragraph.x - 2}
            y={paragraph.y - 1}
            width={paragraph.width + 4}
            height={paragraph.height + 2}
          >
            <title>{`段落 ${index + 1}(${paragraph.lines.length} 行、${paragraph.fontSize} pt)\n${paragraph.text}`}</title>
          </rect>
        ))}
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
