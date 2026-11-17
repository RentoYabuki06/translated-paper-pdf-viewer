import { describe, expect, it } from 'vitest'
import { markDifferences } from '../../src/lib/textDiff.ts'

/** 違う部分を【】で囲んだ文字列にする。 */
function show(base: string, other: string, minSame?: number): string {
  return markDifferences(base, other, minSame)
    .map((segment) => (segment.changed ? `【${segment.text}】` : segment.text))
    .join('')
}

describe('markDifferences', () => {
  it('同じ文字列は、違う部分の無い 1 つの部分になる', () => {
    expect(markDifferences('学習率を下げる。', '学習率を下げる。')).toEqual([{ text: '学習率を下げる。', changed: false }])
  })

  it('返した部分をつなぐと、もとの文字列に戻る', () => {
    const other = '各層の後に、ドロップアウトを適用する。'
    const joined = markDifferences('各レイヤーの後でドロップアウトを使う。', other)
      .map((segment) => segment.text)
      .join('')
    expect(joined).toBe(other)
  })

  it('途中の語が違う場合は、その語だけを違う部分にする', () => {
    expect(show('学習率を小さい値に設定する。', '学習係数を小さい値に設定する。')).toBe('学習【係数】を小さい値に設定する。')
  })

  it('足された部分を、違う部分にする', () => {
    expect(show('注意を用いる。', '注意機構を用いる。')).toBe('注意【機構】を用いる。')
    expect(show('注意を用いる。', 'まず、注意を用いる。')).toBe('【まず、】注意を用いる。')
    expect(show('注意を用いる。', '注意を用いる。以上。')).toBe('注意を用いる。【以上。】')
  })

  it('基準にだけある部分は、どこにも表れない', () => {
    expect(show('注意機構を用いる。', '注意を用いる。')).toBe('注意を用いる。')
  })

  it('まったく違う文字列は、全体が違う部分になる', () => {
    expect(markDifferences('あいう', 'かきく')).toEqual([{ text: 'かきく', changed: true }])
  })

  it('空の文字列を扱える', () => {
    expect(markDifferences('あいう', '')).toEqual([])
    expect(markDifferences('', 'あいう')).toEqual([{ text: 'あいう', changed: true }])
  })

  it('違う部分にはさまれた 1 文字だけの一致は、違う部分にまとめる', () => {
    // 「の」だけが一致する。まとめない場合は、「の」だけが同じ部分として残る。
    expect(show('前者の評価', '後段の検討')).toBe('【後段の検討】')
    expect(show('前者の評価', '後段の検討', 1)).toBe('【後段】の【検討】')
  })

  it('数式の目印は、途中で分けない', () => {
    expect(show('値 <m1> を使う。', '値 <m2> を使う。')).toBe('値 【<m2>】 を使う。')
    expect(show('値 <m1> を使う。', '値 <m12> を使う。')).toBe('値 【<m12>】 を使う。')
  })

  it('違う部分にはさまれた数式の目印は、同じ部分として残す', () => {
    expect(show('ここで<m1>は温度', 'なお<m1>とは温度')).toBe('【なお】<m1>【と】は温度')
  })

  it('長い文字列も比べられる', () => {
    const base = '層の出力に正規化を適用する。'.repeat(120)
    const other = base.replace('正規化', '標準化')
    const segments = markDifferences(base, other)
    expect(segments.map((segment) => segment.text).join('')).toBe(other)
    expect(segments.filter((segment) => segment.changed).map((segment) => segment.text)).toEqual(['標準'])
  })
})
