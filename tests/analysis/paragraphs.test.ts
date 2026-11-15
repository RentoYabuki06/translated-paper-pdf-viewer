import { describe, expect, it } from 'vitest'
import { buildParagraphs, joinLines } from '../../src/analysis/paragraphs.ts'
import { line } from './helpers.ts'

describe('buildParagraphs', () => {
  it('行間が一定の行を、1 つの段落にする', () => {
    const paragraphs = buildParagraphs([
      line('First line of the', 50, 100, 200),
      line('paragraph continues', 50, 112, 200),
      line('to the end.', 50, 124, 80),
    ])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]?.text).toBe('First line of the paragraph continues to the end.')
    expect(paragraphs[0]?.lines).toHaveLength(3)
  })

  it('字下げされた行で、段落を分ける', () => {
    const paragraphs = buildParagraphs([
      line('Indented first line', 65, 100, 185),
      line('second line.', 50, 112, 90),
      line('Next paragraph starts', 65, 124, 185),
      line('and continues.', 50, 136, 100),
    ])
    expect(paragraphs.map((paragraph) => paragraph.lines.length)).toEqual([2, 2])
  })

  it('行間が広がったところで、段落を分ける', () => {
    const paragraphs = buildParagraphs([
      line('a a a a', 50, 100, 200),
      line('b b b b', 50, 112, 200),
      line('c c c c', 50, 136, 200),
    ])
    expect(paragraphs.map((paragraph) => paragraph.lines.length)).toEqual([2, 1])
  })

  it('文字の大きさが違う行を、別の段落にする', () => {
    const paragraphs = buildParagraphs([line('1. Introduction', 50, 100, 90, 12), line('Body text here', 50, 116, 200, 10)])
    expect(paragraphs).toHaveLength(2)
  })

  it('左右の段を、別の段落にする', () => {
    const paragraphs = buildParagraphs([
      line('left 1', 50, 100, 200),
      line('right 1', 300, 100, 200),
      line('left 2', 50, 112, 200),
      line('right 2', 300, 112, 200),
    ])
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(['left 1 left 2', 'right 1 right 2'])
  })

  it('幅いっぱいの行の次の、字下げされた幅いっぱいの行で、段落を分ける', () => {
    const paragraphs = buildParagraphs([
      line('a full width line of the paragraph', 50, 100, 236),
      line('the last line is also full width.', 50, 112, 236),
      line('Indented full width first line', 60, 124, 226),
      line('of the next paragraph.', 50, 136, 120),
    ])
    expect(paragraphs.map((paragraph) => paragraph.lines.length)).toEqual([2, 2])
  })

  it('中央ぞろえの行を、1 つの段落にする', () => {
    const paragraphs = buildParagraphs([line('A Long Title of the Paper', 100, 100, 300, 14), line('Second Line', 190, 117, 120, 14)])
    expect(paragraphs).toHaveLength(1)
  })
})

describe('joinLines', () => {
  it('行末のハイフンで分かれた語を、つなぎ直す', () => {
    expect(joinLines([line('the trans-', 0, 0, 10), line('lation model', 0, 12, 10)])).toBe('the translation model')
  })

  it('次の行が大文字で始まる場合は、ハイフンを残す', () => {
    expect(joinLines([line('the Encoder-', 0, 0, 10), line('Decoder model', 0, 12, 10)])).toBe('the Encoder- Decoder model')
  })
})
