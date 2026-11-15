import { describe, expect, it } from 'vitest'
import { checkTags, escapeTagLike, mathTag, normalizeTags, splitByTags, tagIds } from '../../src/math/placeholders.ts'

describe('mathTag', () => {
  it('番号だけの目印を作る', () => {
    expect(mathTag(3)).toBe('<m3>')
  })
})

describe('normalizeTags', () => {
  it('全角の山括弧、内側の空白、大文字を直す', () => {
    expect(normalizeTags('＜m1＞ と < M 2 > と <m3>')).toBe('<m1> と <m2> と <m3>')
  })

  it('目印でない山括弧は変えない', () => {
    expect(normalizeTags('a < b と <em>')).toBe('a < b と <em>')
  })
})

describe('escapeTagLike', () => {
  it('本文にある目印の形の文字列を、目印として読まれない形にする', () => {
    const escaped = escapeTagLike('the tag <m1> and </m2> in text, a < b')
    expect(tagIds(escaped)).toEqual([])
    expect(escaped).toContain('a < b')
  })
})

describe('tagIds', () => {
  it('目印の番号を、現れた順に返す', () => {
    expect(tagIds('<m2> は <m1> より大きく、<m10> 以下')).toEqual([2, 1, 10])
  })
})

describe('checkTags', () => {
  it('すべての目印がちょうど 1 回ずつあれば合格', () => {
    expect(checkTags('<m2> と <m1>', [1, 2])).toEqual({ ok: true, problems: [] })
    expect(checkTags('目印の無い文', [])).toEqual({ ok: true, problems: [] })
  })

  it('欠けた目印、重複した目印、原文に無い番号の目印を報告する', () => {
    expect(checkTags('<m1> と <m1> と <m4>', [1, 2])).toEqual({
      ok: false,
      problems: ['m1:duplicated', 'm2:missing', 'm4:unknown'],
    })
  })

  it('閉じる側の形の目印を報告する', () => {
    expect(checkTags('<m1>x</m1>', [1]).problems).toEqual(['m1:closing'])
  })

  it('一部の番号だけを含む文も検査できる', () => {
    expect(checkTags('<m3> である。', [3]).ok).toBe(true)
    expect(checkTags('<m3> である。', [3, 4]).problems).toEqual(['m4:missing'])
  })
})

describe('splitByTags', () => {
  it('文章の部分と、目印の部分に分ける', () => {
    expect(splitByTags('関数 <m1> は<m2>。')).toEqual([
      { type: 'text', text: '関数 ' },
      { type: 'math', id: 1 },
      { type: 'text', text: ' は' },
      { type: 'math', id: 2 },
      { type: 'text', text: '。' },
    ])
  })

  it('目印が無ければ、文章 1 つを返す', () => {
    expect(splitByTags('文章')).toEqual([{ type: 'text', text: '文章' }])
    expect(splitByTags('')).toEqual([])
  })
})
