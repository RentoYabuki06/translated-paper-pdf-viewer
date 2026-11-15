import { describe, expect, it } from 'vitest'
import { dominantTextFont, isMathFontName, markMath, stripSubsetPrefix } from '../../src/math/detect.ts'

describe('stripSubsetPrefix', () => {
  it('部分埋め込みの印を取り除く', () => {
    expect(stripSubsetPrefix('MJNQMS+CMSY10')).toBe('CMSY10')
    expect(stripSubsetPrefix('Times-Roman')).toBe('Times-Roman')
  })
})

describe('isMathFontName', () => {
  it.each(['YYBXCM+CMMI10', 'MJNQMS+CMSY10', 'THPNLT+CMEX9', 'ABCDEF+MSBM10', 'ABCDEF+LatinModernMath-Regular', 'ABCDEF+NewTXMI', 'ABCDEF+STIXTwoMath'])(
    '%s を数式用のフォントとする',
    (name) => {
      expect(isMathFontName(name)).toBe(true)
    },
  )

  it.each(['CCHXUK+NimbusRomNo9L-Regu', 'LJXNUA+CMR10', 'ABCDEF+CMTT10', 'Times-Roman', 'XEXHSJ+SFTT1000', ''])(
    '%s を数式用のフォントとしない',
    (name) => {
      expect(isMathFontName(name)).toBe(false)
    },
  )
})

describe('dominantTextFont', () => {
  it('文字数が最も多いフォントを返し、数式用のフォントは数えない', () => {
    const font = dominantTextFont([
      { text: 'abc', fontName: 'ABCDEF+NimbusRomNo9L-Regu' },
      { text: 'xxxxxxxx', fontName: 'ABCDEF+CMMI10' },
      { text: 'de', fontName: 'ABCDEF+NimbusRomNo9L-Medi' },
    ])
    expect(font).toBe('ABCDEF+NimbusRomNo9L-Regu')
  })
})

describe('markMath', () => {
  const times = 'ABCDEF+NimbusRomNo9L-Regu'

  it('数式用のフォントの文字を、数式とする', () => {
    const [run] = markMath([{ text: 'x', fontName: 'ABCDEF+CMMI10' }], times)
    expect(run?.isMath).toBe(true)
  })

  it('本文が Computer Modern でない場合は、CMR と CMBX の文字も数式とする', () => {
    const runs = markMath(
      [
        { text: '1', fontName: 'ABCDEF+CMR10' },
        { text: 'x', fontName: 'ABCDEF+CMBX10' },
        { text: 'code', fontName: 'ABCDEF+CMTT10' },
      ],
      times,
    )
    expect(runs.map((run) => run.isMath)).toEqual([true, true, false])
  })

  it('本文が Computer Modern の場合は、CMR の文字を数式としない', () => {
    const [run] = markMath([{ text: 'text', fontName: 'ABCDEF+CMR10' }], 'GHIJKL+CMR10')
    expect(run?.isMath).toBe(false)
  })

  it('空白だけのまとまりを、数式用のフォントでも数式としない', () => {
    const [run] = markMath([{ text: '  ', fontName: 'ABCDEF+CMR10' }], times)
    expect(run?.isMath).toBe(false)
  })

  it('数学記号だけの文字列を、フォントによらず数式とする', () => {
    const runs = markMath(
      [
        { text: '≤', fontName: times },
        { text: 'α', fontName: times },
        { text: 'a ≤ b', fontName: times },
      ],
      times,
    )
    expect(runs.map((run) => run.isMath)).toEqual([true, true, false])
  })
})
