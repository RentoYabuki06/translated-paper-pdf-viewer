import { describe, expect, it } from 'vitest'
import type { TranslationUnit } from '../../src/analysis/units.ts'
import { buildContexts, formatContext } from '../../src/translate/context.ts'

/** テスト用の翻訳単位を作る。幅 200、高さ 34 の断片を 1 つ持つ。 */
function unit(id: string, source: string, options: Partial<TranslationUnit> & { x?: number; y?: number } = {}): TranslationUnit {
  const { x = 50, y = 100, ...rest } = options
  return {
    id,
    pageNumber: 1,
    index: 0,
    order: y,
    source,
    prefix: '',
    math: [],
    kind: 'text',
    fontSize: 10,
    linePitch: 12,
    fragments: [{ pageNumber: 1, rect: { x, y, width: 200, height: 34 }, lineCount: 3, indented: false, maxWidth: 200, maxHeight: 34 }],
    atColumnTop: false,
    atColumnBottom: false,
    lastLineFull: true,
    ...rest,
  }
}

describe('formatContext', () => {
  it('題名、節の見出し、直前の段落、直後の本文を、ラベルを付けて並べる', () => {
    expect(formatContext({ title: 'A Paper', section: '2 Method', previous: 'We train a model.', following: 'where x is small.' })).toBe(
      'Title: A Paper\nSection: 2 Method\nPrevious paragraph: We train a model.\nFollowing text: where x is small.',
    )
  })

  it('空の項目は出さない。すべて空なら、文脈を付けない', () => {
    expect(formatContext({ title: 'A Paper', section: '', previous: '', following: '' })).toBe('Title: A Paper')
    expect(formatContext({ title: '', section: '', previous: '', following: '' })).toBeUndefined()
  })

  it('数式の目印を「…」に置き換え、空白をそろえる', () => {
    expect(formatContext({ title: '', section: '', previous: 'Let <m1>  be\nthe rate <m12>.', following: '' })).toBe(
      'Previous paragraph: Let … be the rate ….',
    )
  })

  it('直前の段落は、後ろから 400 文字までを、単語の切れ目で切り取る', () => {
    const previous = `${'start '.repeat(100)}the end of the paragraph.`
    const context = formatContext({ title: '', section: '', previous, following: '' }) ?? ''
    const body = context.replace('Previous paragraph: ', '')
    expect(body.startsWith('… start')).toBe(true)
    expect(body.endsWith('the end of the paragraph.')).toBe(true)
    expect(body.length).toBeLessThanOrEqual(402)
  })

  it('直後の本文は、前から 200 文字までを、単語の切れ目で切り取る', () => {
    const following = `where the value is small ${'and more '.repeat(60)}`
    const context = formatContext({ title: '', section: '', previous: '', following }) ?? ''
    const body = context.replace('Following text: ', '')
    expect(body.startsWith('where the value is small')).toBe(true)
    expect(body.endsWith(' …')).toBe(true)
    expect(body.length).toBeLessThanOrEqual(202)
  })
})

describe('buildContexts', () => {
  const heading = unit('h', '2 Method', { kind: 'paragraph_title', y: 100 })
  const first = unit('a', 'We train a model.', { y: 150 })
  const second = unit('b', 'It works well.', { y: 200 })

  it('本文には、題名、節の見出し、直前の本文を付ける', () => {
    const page = [heading, first, second]
    const contexts = buildContexts({ title: 'A Paper', previousPage: null, page, units: page })
    expect(contexts.get('a')).toBe('Title: A Paper\nSection: 2 Method')
    expect(contexts.get('b')).toBe('Title: A Paper\nSection: 2 Method\nPrevious paragraph: We train a model.')
  })

  it('見出しをはさむと、直前の本文を引き継がない', () => {
    const next = unit('h2', '3 Results', { kind: 'paragraph_title', y: 250 })
    const third = unit('c', 'The error is low.', { y: 300 })
    const page = [heading, first, next, third]
    const contexts = buildContexts({ title: '', previousPage: null, page, units: page })
    expect(contexts.get('c')).toBe('Section: 3 Results')
  })

  it('節の見出しと直前の本文を、前のページからも探す', () => {
    const page = [unit('c', 'The error is low.', { y: 80 })]
    const contexts = buildContexts({ title: 'A Paper', previousPage: [heading, first], page, units: page })
    expect(contexts.get('c')).toBe('Title: A Paper\nSection: 2 Method\nPrevious paragraph: We train a model.')
  })

  it('節の見出しには、題名と、その節の最初の本文を付ける', () => {
    const empty = unit('h0', '1 Overview', { kind: 'paragraph_title', y: 60 })
    const page = [empty, heading, first, second]
    const contexts = buildContexts({ title: 'A Paper', previousPage: null, page, units: page })
    expect(contexts.get('h')).toBe('Title: A Paper\nFollowing text: We train a model.')
    // すぐ次が別の見出しの場合は、題名だけ。
    expect(contexts.get('h0')).toBe('Title: A Paper')
  })

  it('題名には文脈を付けず、要旨・説明文・脚注には題名だけを付ける', () => {
    const page = [
      unit('t', 'A Paper', { kind: 'doc_title', y: 50 }),
      unit('abs', 'We study models.', { kind: 'abstract', y: 80 }),
      heading,
      first,
      unit('cap', 'Figure 1. The model.', { kind: 'figure_title', y: 300 }),
      unit('fn', 'A footnote.', { kind: 'footnote', y: 400 }),
    ]
    const contexts = buildContexts({ title: 'A Paper', previousPage: null, page, units: page })
    expect(contexts.has('t')).toBe(false)
    expect(contexts.get('abs')).toBe('Title: A Paper')
    expect(contexts.get('cap')).toBe('Title: A Paper')
    expect(contexts.get('fn')).toBe('Title: A Paper')
  })

  it('説明文や脚注は、直前の本文として数えない。要旨は数える', () => {
    const page = [
      unit('abs', 'We study models.', { kind: 'abstract', y: 80 }),
      unit('cap', 'Figure 1. The model.', { kind: 'figure_title', y: 120 }),
      first,
    ]
    const contexts = buildContexts({ title: '', previousPage: null, page, units: page })
    expect(contexts.get('a')).toBe('Previous paragraph: We study models.')
  })

  it('文の途中で終わる段落には、同じ段の真下にある本文を、直後の本文として付ける', () => {
    const open = unit('open', 'The loss is defined as', { y: 100 })
    const where = unit('where', 'where <m1> is the rate.', { y: 200 })
    const otherColumn = unit('other', 'Another column.', { x: 300, y: 150 })
    const page = [open, otherColumn, where]
    const contexts = buildContexts({ title: '', previousPage: null, page, units: page })
    expect(contexts.get('open')).toBe('Following text: where … is the rate.')
    // 文が終わっている段落には、付けない。
    expect(contexts.get('where')).toBe('Previous paragraph: Another column.')
  })

  it('コロンで終わる段落も、文が続くとみなす', () => {
    const open = unit('open', 'The logits are scaled as follows:', { y: 100 })
    const where = unit('where', 'where <m1> is the temperature.', { y: 200 })
    const contexts = buildContexts({ title: '', previousPage: null, page: [open, where], units: [open, where] })
    expect(contexts.get('open')).toBe('Following text: where … is the temperature.')
  })

  it('段やページをまたいでつないだ翻訳単位には、最初の断片の位置での文脈を付け、直後の本文は付けない', () => {
    const tailPart = unit('tail', 'The model is trained on a large', { y: 600 })
    const headPart = unit('head', 'corpus of documents.', { x: 300, y: 100 })
    const joined = { ...tailPart, source: 'The model is trained on a large corpus of documents.', fragments: [...tailPart.fragments, ...headPart.fragments] }
    const contexts = buildContexts({ title: '', previousPage: null, page: [heading, first, tailPart, headPart], units: [heading, first, joined] })
    expect(contexts.get('tail')).toBe('Section: 2 Method\nPrevious paragraph: We train a model.')
  })
})
