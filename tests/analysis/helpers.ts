import type { Line, LineChar, RunChar, TextRun } from '../../src/analysis/types.ts'

/**
 * テスト用の文字のまとまりを作る。
 * 1 文字の幅は、文字の大きさの半分。文字列の中の空白は、文字を置かない空き(幅は同じ)になる。
 * 高さは文字の大きさと同じにし、基準線は下から 2 割の位置に置く。
 */
export function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const fontSize = options.fontSize ?? 10
  const charWidth = fontSize * 0.5
  const chars: RunChar[] = []
  Array.from(text).forEach((char, index) => {
    if (char !== ' ') chars.push({ text: char, x: x + index * charWidth, width: charWidth, fontChar: char })
  })
  return {
    text,
    chars,
    x,
    y: baseline - fontSize * 0.8,
    width: text.length * charWidth,
    height: fontSize,
    fontSize,
    fontName: 'Body',
    fontId: 'f1',
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
    chars: [],
    spans: [],
    fontSize,
    baseline,
    mathRatio: 0,
  }
}

/** まとまりの文字を、行の文字の形にする。 */
export function lineChars(source: TextRun, options: Partial<LineChar> = {}): LineChar[] {
  return source.chars.map((char) => ({
    ...char,
    baseline: source.baseline,
    fontSize: source.fontSize,
    fontName: source.fontName,
    fontId: source.fontId,
    top: source.y,
    bottom: source.y + source.height,
    math: source.isMath,
    satellite: false,
    ...options,
  }))
}

/** テスト用の行を、文字付きで作る。幅は、文字の並びとは別に指定できる。 */
export function lineWithChars(text: string, x: number, baseline: number, width: number, fontSize = 10): Line {
  return { ...line(text, x, baseline, width, fontSize), chars: lineChars(run(text, x, baseline, { fontSize })) }
}
