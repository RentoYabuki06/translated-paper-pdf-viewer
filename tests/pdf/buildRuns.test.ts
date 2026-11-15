import { describe, expect, it } from 'vitest'
import { buildRuns, verticalExtent } from '../../src/pdf/buildRuns.ts'
import type { Glyph } from '../../src/pdf/glyphs.ts'

const FONTS: Record<string, { name: string; ascent: number; descent: number }> = {
  f1: { name: 'ABCDEF+Body', ascent: 0.7, descent: -0.2 },
  f2: { name: 'ABCDEF+CMMI10', ascent: 0.7, descent: -0.2 },
  ex: { name: 'ABCDEF+CMEX10', ascent: 0.04, descent: -0.6 },
}
const getFont = (id: string) => FONTS[id]

/** 文字列を、幅 5 ポイントの文字として、x から順に並べる。空白は、文字を置かない空きになる。 */
function glyphs(text: string, x: number, options: Partial<Glyph> = {}): Glyph[] {
  return Array.from(text).flatMap((char, index) =>
    char === ' '
      ? []
      : [{ text: char, fontChar: char, fontId: 'f1', x: x + index * 5, baseline: 100, width: 5, fontSize: 10, rotated: false, ...options }],
  )
}

describe('buildRuns', () => {
  it('同じフォントで続く文字を 1 つのまとまりにし、すき間に空白を補う', () => {
    const runs = buildRuns(glyphs('ab cd', 50), getFont)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ text: 'ab cd', x: 50, width: 25, fontName: 'ABCDEF+Body', fontId: 'f1', baseline: 100 })
    expect(runs[0]?.chars.map((char) => [char.text, char.x])).toEqual([
      ['a', 50],
      ['b', 55],
      ['c', 65],
      ['d', 70],
    ])
  })

  it('フォントの高さの情報から、縦の範囲を決める', () => {
    const [run] = buildRuns(glyphs('a', 50), getFont)
    expect(run?.y).toBeCloseTo(93)
    expect(run?.height).toBeCloseTo(9)
  })

  it('フォント、大きさ、基準線のどれかが変わると、まとまりを分ける', () => {
    const runs = buildRuns(
      [
        ...glyphs('ab', 50),
        ...glyphs('x', 60, { fontId: 'f2' }),
        ...glyphs('2', 65, { fontSize: 7 }),
        ...glyphs('c', 70, { baseline: 103 }),
      ],
      getFont,
    )
    expect(runs.map((run) => run.text)).toEqual(['ab', 'x', '2', 'c'])
  })

  it('大きく離れた文字と、左に戻った文字で、まとまりを分ける', () => {
    const runs = buildRuns([...glyphs('ab', 50), ...glyphs('cd', 80), ...glyphs('ef', 60)], getFont)
    expect(runs.map((run) => run.text)).toEqual(['ab', 'cd', 'ef'])
  })

  it('空白の文字は含めず、すき間として扱う', () => {
    const runs = buildRuns([...glyphs('a', 50), ...glyphs(' ', 55), ...glyphs('b', 60)], getFont)
    expect(runs.map((run) => run.text)).toEqual(['a b'])
    expect(runs[0]?.chars).toHaveLength(2)
  })

  it('回転した文字は、1 文字ずつのまとまりにする', () => {
    const runs = buildRuns(glyphs('ab', 50, { rotated: true }), getFont)
    expect(runs.map((run) => [run.text, run.rotated])).toEqual([
      ['a', true],
      ['b', true],
    ])
  })
})

describe('verticalExtent', () => {
  it('字形が基準線からぶら下がるフォントは、基準線の下に範囲を取る', () => {
    expect(verticalExtent(FONTS.ex)).toEqual({ ascent: 0.05, descent: -1 })
  })

  it('字形の範囲を測れる場合は、上端が低く下端が深い字形を、ぶら下がる字形とする', () => {
    const radical = { fontId: 'sy', chars: [{ text: '√', x: 0, width: 8, fontChar: 'p' }] }
    const measure = () => ({ ascent: 0.04, descent: 0.96, left: 0, right: 0.8 })
    expect(verticalExtent(FONTS.f2, radical, measure)).toEqual({ ascent: 0.04, descent: -0.96 })
    // ふつうの字形は、フォントの高さの情報のまま。
    const letter = { fontId: 'f2', chars: [{ text: 'x', x: 0, width: 5, fontChar: 'x' }] }
    expect(verticalExtent(FONTS.f2, letter, () => ({ ascent: 0.43, descent: 0.01, left: 0, right: 0.5 }))).toEqual({
      ascent: 0.7,
      descent: -0.2,
    })
  })

  it('字形の範囲を測れない場合は、根号の記号を、ぶら下がる字形とする', () => {
    const radical = { fontId: 'sy', chars: [{ text: '√', x: 0, width: 8, fontChar: 'p' }] }
    expect(verticalExtent(FONTS.f2, radical)).toEqual({ ascent: 0.05, descent: -1 })
  })

  it('値が範囲の外にある場合や、情報が無い場合は、既定の値を使う', () => {
    expect(verticalExtent({ name: '', ascent: 3, descent: -2 })).toEqual({ ascent: 0.8, descent: -0.2 })
    expect(verticalExtent(undefined)).toEqual({ ascent: 0.8, descent: -0.2 })
  })
})
