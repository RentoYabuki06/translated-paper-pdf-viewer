import type { Line, TextRun } from '../../src/analysis/types.ts'

/** テスト用の文字のまとまりを作る。高さは文字の大きさと同じにし、基準線は下から 2 割の位置に置く。 */
export function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const fontSize = options.fontSize ?? 10
  return {
    text,
    x,
    y: baseline - fontSize * 0.8,
    width: text.length * fontSize * 0.5,
    height: fontSize,
    fontSize,
    fontName: 'Body',
    baseline,
    rotated: false,
    isMath: false,
    ...options,
  }
}

/** テスト用の行を作る。 */
export function line(text: string, x: number, baseline: number, width: number, fontSize = 10): Line {
  return {
    text,
    x,
    y: baseline - fontSize * 0.8,
    width,
    height: fontSize,
    runs: [],
    fontSize,
    baseline,
    mathRatio: 0,
  }
}
