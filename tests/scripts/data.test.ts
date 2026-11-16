import { describe, expect, it } from 'vitest'
import { CONTEXT_PARAGRAPHS, CONTEXT_TITLE } from '../../scripts/data/contextParagraphs.ts'
import { MATH_SENTENCES } from '../../scripts/data/mathSentences.ts'
import { buildParagraphs, fillTemplate, plainSentence } from '../../scripts/lib/paragraphs.ts'
import { median, sum } from '../../src/lib/stats.ts'
import { tagIds } from '../../src/math/placeholders.ts'

describe('MATH_SENTENCES(実験用の文のデータ)', () => {
  it('60 件ある', () => {
    expect(MATH_SENTENCES).toHaveLength(60)
  })

  it('どの文も、数式の位置 {0}〜{n-1} をちょうど 1 回ずつ含む', () => {
    for (const sentence of MATH_SENTENCES) {
      const found = [...sentence.template.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]))
      const expected = sentence.math.map((_, index) => index)
      expect([...found].sort((a, b) => a - b), sentence.template).toEqual(expected)
    }
  })

  it('どの文も数式を 1 つ以上持ち、数式の文字列は空でない', () => {
    for (const sentence of MATH_SENTENCES) {
      expect(sentence.math.length, sentence.template).toBeGreaterThan(0)
      for (const math of sentence.math) {
        expect(math.trim().length, sentence.template).toBeGreaterThan(0)
      }
    }
  })

  it('同じ文が重複していない', () => {
    const templates = MATH_SENTENCES.map((sentence) => sentence.template)
    expect(new Set(templates).size).toBe(templates.length)
  })
})

describe('fillTemplate と plainSentence', () => {
  it('位置の番号に対応する文字列を埋め込む', () => {
    expect(fillTemplate('{1} comes after {0}.', ['a', 'b'])).toBe('b comes after a.')
  })

  it('対応する文字列が無い位置は、そのまま残す', () => {
    expect(fillTemplate('{0} and {3}', ['a'])).toBe('a and {3}')
  })

  it('数式を文字のまま埋め込んだ文にする', () => {
    expect(plainSentence({ template: 'Let {0} be {1}.', math: ['x', 'positive'] })).toBe('Let x be positive.')
  })
})

describe('buildParagraphs', () => {
  const sentences = [
    { template: 'A {0}.', math: ['1'] },
    { template: 'B {0}.', math: ['2'] },
    { template: 'C {0}.', math: ['3'] },
  ]

  it('指定した件数と文数の段落を作り、文が足りなければ先頭に戻る', () => {
    expect(buildParagraphs(sentences, 2, 2)).toEqual(['A 1. B 2.', 'C 3. A 1.'])
  })

  it('実験用のデータから、位置の番号が残らない段落を作る', () => {
    const paragraphs = buildParagraphs(MATH_SENTENCES, 20, 5)
    expect(paragraphs).toHaveLength(20)
    for (const paragraph of paragraphs) {
      expect(paragraph).not.toMatch(/\{\d+\}/)
    }
  })

  it('文が 1 件も無ければエラーにする', () => {
    expect(() => buildParagraphs([], 1, 1)).toThrow()
  })
})

describe('sum と median', () => {
  it('合計を返す', () => {
    expect(sum([1, 2, 3.5])).toBe(6.5)
    expect(sum([])).toBe(0)
  })

  it('中央値を返す', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(() => median([])).toThrow()
  })
})

describe('CONTEXT_PARAGRAPHS(文脈の実験用の文章)', () => {
  it('見出しから始まり、見出しと本文の両方を含む', () => {
    expect(CONTEXT_PARAGRAPHS[0]?.kind).toBe('heading')
    expect(CONTEXT_PARAGRAPHS.some((paragraph) => paragraph.kind === 'body')).toBe(true)
    expect(CONTEXT_TITLE.length).toBeGreaterThan(0)
  })

  it('どの段落も、数式の目印を 1 から順に、ちょうど 1 回ずつ含む', () => {
    for (const paragraph of CONTEXT_PARAGRAPHS) {
      const ids = tagIds(paragraph.text)
      expect(ids, paragraph.text).toEqual(ids.map((_, index) => index + 1))
    }
  })

  it('同じ段落が重複していない', () => {
    const texts = CONTEXT_PARAGRAPHS.map((paragraph) => paragraph.text)
    expect(new Set(texts).size).toBe(texts.length)
  })
})
