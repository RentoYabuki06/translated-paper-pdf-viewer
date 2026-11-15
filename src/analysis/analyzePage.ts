/**
 * 1 ページ分の解析。文字のまとまり → 数式の判定 → 行 → 段落。
 */

import type { PDFPageProxy } from 'pdfjs-dist'
import { dominantTextFont, markMath } from '../math/detect.ts'
import type { GlyphInkMeasurer } from '../pdf/glyphInk.ts'
import { extractRuns } from '../pdf/runs.ts'
import { buildLines } from './lines.ts'
import { buildParagraphs } from './paragraphs.ts'
import type { Line, Paragraph, TextRun } from './types.ts'

export interface PageAnalysis {
  runs: TextRun[]
  lines: Line[]
  paragraphs: Paragraph[]
  /** このページで本文のフォントと判定した名前。 */
  bodyFont: string
}

export async function analyzePage(page: PDFPageProxy, measureInk?: GlyphInkMeasurer): Promise<PageAnalysis> {
  const rawRuns = await extractRuns(page, measureInk)
  const bodyFont = dominantTextFont(rawRuns)
  const runs = markMath(rawRuns, bodyFont)
  const lines = buildLines(runs)
  const paragraphs = buildParagraphs(lines)
  return { runs, lines, paragraphs, bodyFont }
}
