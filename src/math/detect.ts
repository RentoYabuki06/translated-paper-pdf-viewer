/**
 * 数式の文字を、主にフォントの名前で検出する。
 *
 * LaTeX で作った PDF は、数式の文字を数式用のフォントで書く。
 * 本文が Times などの場合は、数式の中の数字や演算子に Computer Modern のローマン体(CMR)が使われるため、
 * 本文のフォントが Computer Modern でないときに限り、CMR と CMBX も数式とみなす。
 * 補助として、数学記号だけでできた文字列も数式とみなす。
 * 文字の大きさと上下のずれ(添字)による検出は、まだ行っていない。
 */

import type { TextRun } from '../analysis/types.ts'

/** 名前の先頭に付く、部分埋め込みの印(例: "ABCDEF+")を取り除く。 */
export function stripSubsetPrefix(fontName: string): string {
  return fontName.replace(/^[A-Z]{6}\+/, '')
}

/** 数式用のフォントの名前。 */
const MATH_FONT_PATTERN = new RegExp(
  [
    '^CM(MI|SY|EX|BSY|MIB)\\d*', // Computer Modern の数式用
    '^(MSAM|MSBM|EUFM|EUSM|EURM|EUEX|RSFS|LASY|STMARY|WASY|BBM|DSROM|DSSS)\\d*', // AMS などの記号
    '^(RTXMI|TXMI|TXSY|TXEX|PXMI|PXSY|PXEX|NTXMI|NTXSY|NTXEX|NEWTXMI|NEWTXBMI|NEWPXMI|NEWTXSY)', // txfonts、newtx の数式用
    '^MT(MI|SY|EX|GU)', // MathTime
    '^(FDSYMBOL|MNSYMBOL|MDSYMBOL)',
    'MATH', // "LatinModernMath"、"STIXTwoMath"、"CambriaMath"、"MathematicalPi" など
    '^SYMBOL(MT)?$',
  ].join('|'),
  'i',
)

/** Computer Modern の本文用のフォント(ローマン体など)。 */
const CM_TEXT_FONT_PATTERN = /^(CM(R|BX|TI|SS|TT|SL|CSC|BXTI|SSBX|SSI)|SF(RM|BX|TI|SS|TT))\d+$/i

/**
 * Computer Modern のうち、数式の中の数字・演算子・太字の変数に使われる書体(ローマン体と太字)。
 * 等幅の書体(CMTT)は、URL やコードに使われるため含めない。
 */
const CM_MATH_ROMAN_PATTERN = /^CM(R|BX)\d+$/i

/** 数学記号、ギリシャ文字、演算子だけでできた文字列。 */
const MATH_SYMBOLS_PATTERN =
  /^[\sͰ-Ͽ←-⇿∀-⋿⟀-⟯⦀-⫿\u{1D400}-\u{1D7FF}=+<>×÷±∓−·]+$/u

export function isMathFontName(fontName: string): boolean {
  return MATH_FONT_PATTERN.test(stripSubsetPrefix(fontName))
}

export function isComputerModernTextFontName(fontName: string): boolean {
  return CM_TEXT_FONT_PATTERN.test(stripSubsetPrefix(fontName))
}

/** 文字数で数えて、最も多く使われているフォントの名前を返す。数式用のフォントは数えない。 */
export function dominantTextFont(runs: readonly Pick<TextRun, 'text' | 'fontName'>[]): string {
  const counts = new Map<string, number>()
  for (const run of runs) {
    if (run.fontName === '' || isMathFontName(run.fontName)) continue
    counts.set(run.fontName, (counts.get(run.fontName) ?? 0) + run.text.length)
  }
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

/**
 * 各まとまりが数式の文字かどうかを判定し、isMath を設定した新しい配列を返す。
 * bodyFont には、文書の本文のフォントの名前を渡す(dominantTextFont の結果)。
 */
export function markMath<T extends Pick<TextRun, 'text' | 'fontName'>>(
  runs: readonly T[],
  bodyFont: string,
): (T & { isMath: boolean })[] {
  const bodyIsComputerModern = isComputerModernTextFontName(bodyFont)
  return runs.map((run) => {
    const byFont =
      isMathFontName(run.fontName) ||
      (!bodyIsComputerModern && bodyFont !== '' && CM_MATH_ROMAN_PATTERN.test(stripSubsetPrefix(run.fontName)))
    // 空白だけのまとまり(数式と数式番号の間の空きなど)は、数式としない。
    if (run.text.trim().length === 0) return { ...run, isMath: false }
    const bySymbols = MATH_SYMBOLS_PATTERN.test(run.text)
    return { ...run, isMath: byFont || bySymbols }
  })
}
