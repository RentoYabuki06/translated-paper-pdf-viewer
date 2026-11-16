import { describe, expect, it } from 'vitest'
import { continuesInto, joinUnits, linkPage } from '../../src/analysis/chains.ts'
import type { MathSlot } from '../../src/analysis/source.ts'
import type { TranslationUnit } from '../../src/analysis/units.ts'

interface Options extends Partial<TranslationUnit> {
  x?: number
  y?: number
  indented?: boolean
}

/** テスト用の翻訳単位を作る。幅 200、高さ 34 の断片を 1 つ持つ。 */
function unit(id: string, source: string, options: Options = {}): TranslationUnit {
  const { x = 50, y = 100, indented = false, ...rest } = options
  const pageNumber = rest.pageNumber ?? 1
  return {
    id,
    pageNumber,
    index: 0,
    order: y,
    source,
    math: [],
    kind: 'text',
    fontSize: 10,
    linePitch: 12,
    fragments: [{ pageNumber, rect: { x, y, width: 200, height: 34 }, lineCount: 3, indented, maxWidth: 200, maxHeight: 34 }],
    atColumnTop: false,
    atColumnBottom: false,
    lastLineFull: true,
    ...rest,
  }
}

function slot(id: number, pageNumber = 1): MathSlot {
  return { id, text: `x${id}`, parts: [{ pageNumber, x: 0, y: 0, width: 10, height: 10, baseline: 8 }] }
}

/** 左の段のいちばん下で、文の途中で終わる段落。 */
const tail = (source = 'The model is trained on a large', options: Options = {}) =>
  unit('tail', source, { x: 50, y: 600, atColumnBottom: true, ...options })

/** 右の段のいちばん上から始まる段落。 */
const head = (source = 'corpus of documents. It works.', options: Options = {}) =>
  unit('head', source, { x: 300, y: 100, atColumnTop: true, ...options })

describe('continuesInto', () => {
  it('段のいちばん下で文が終わっておらず、次の段のいちばん上が字下げされていなければ、続きとみなす', () => {
    expect(continuesInto(tail(), head())).toBe(true)
  })

  it.each(['It ends here.', 'Does it end?', 'It ends (here.)', 'As follows:', 'He said "stop."'])(
    '文の終わりの記号で終わる段落(%s)は、続かない',
    (source) => {
      expect(continuesInto(tail(source), head())).toBe(false)
    },
  )

  it('最後の行が短い段落は、続かない', () => {
    expect(continuesInto(tail(undefined, { lastLineFull: false }), head())).toBe(false)
  })

  it('字下げで始まる段落へは、続かない', () => {
    expect(continuesInto(tail(), head(undefined, { indented: true }))).toBe(false)
  })

  it('本文どうしでなければ、続かない', () => {
    expect(continuesInto(tail(), head(undefined, { kind: 'paragraph_title' }))).toBe(false)
    expect(continuesInto(tail(undefined, { kind: 'figure_title' }), head())).toBe(false)
  })

  it('段のいちばん下・いちばん上でなければ、続かない', () => {
    expect(continuesInto(tail(undefined, { atColumnBottom: false }), head())).toBe(false)
    expect(continuesInto(tail(), head(undefined, { atColumnTop: false }))).toBe(false)
  })

  it('文字の大きさが違えば、続かない', () => {
    expect(continuesInto(tail(), head(undefined, { fontSize: 8 }))).toBe(false)
  })
})

describe('joinUnits', () => {
  it('原文を空白でつなぎ、断片を並べる', () => {
    const joined = joinUnits(tail(), head(undefined, { lastLineFull: false, atColumnBottom: true }))
    expect(joined.id).toBe('tail')
    expect(joined.source).toBe('The model is trained on a large corpus of documents. It works.')
    expect(joined.fragments.map((fragment) => fragment.rect.x)).toEqual([50, 300])
    // 段の下端かどうかと、最後の行の長さは、後ろの段落のものになる。
    expect(joined).toMatchObject({ atColumnBottom: true, lastLineFull: false })
  })

  it('行末のハイフンで分かれた語を、つなぎ直す', () => {
    expect(joinUnits(tail('learned represen-'), head('tations of words.')).source).toBe('learned representations of words.')
  })

  it('後ろの段落の目印の番号を、前の段落の数式の数だけずらす', () => {
    const joined = joinUnits(
      tail('We set <m1> and use', { math: [slot(1)] }),
      head('the values <m1> and <m2> here.', { math: [slot(1), slot(2)] }),
    )
    expect(joined.source).toBe('We set <m1> and use the values <m2> and <m3> here.')
    expect(joined.math.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('数式で終わり、数式で始まる場合は、1 つの目印にまとめる', () => {
    const joined = joinUnits(
      tail('the sum is <m1>', { math: [slot(1)] }),
      head('<m1> where <m2> holds.', { math: [slot(1, 2), slot(2, 2)], pageNumber: 2 }),
    )
    expect(joined.source).toBe('the sum is <m1> where <m2> holds.')
    expect(joined.math).toHaveLength(2)
    expect(joined.math[0]?.parts.map((part) => part.pageNumber)).toEqual([1, 2])
    expect(joined.math[1]).toMatchObject({ id: 2, text: 'x2' })
  })
})

describe('linkPage', () => {
  const heading = unit('heading', '2 Method', { x: 50, y: 100, kind: 'paragraph_title', atColumnTop: true })
  const body = unit('body', 'A complete paragraph.', { x: 50, y: 200 })

  it('段をまたいで続く段落を、1 つの翻訳単位にする', () => {
    const next = unit('after', 'The next paragraph.', { x: 300, y: 200, atColumnBottom: true })
    const linked = linkPage(null, [heading, body, tail(), head(), next], null)
    expect(linked.units.map((item) => item.id)).toEqual(['heading', 'body', 'tail', 'after'])
    expect(linked.units[2]?.fragments).toHaveLength(2)
    expect(linked.units[2]?.source).toBe('The model is trained on a large corpus of documents. It works.')
  })

  it('次の段のいちばん上が見出しなら、つながない', () => {
    const title = unit('title', '3 Results', { x: 300, y: 100, kind: 'paragraph_title', atColumnTop: true })
    const below = unit('below', 'corpus of documents.', { x: 300, y: 150 })
    const linked = linkPage(null, [tail(), title, below], null)
    expect(linked.units.map((item) => item.id)).toEqual(['tail', 'title', 'below'])
  })

  it('文が終わっている段落は、つながない', () => {
    const linked = linkPage(null, [tail('It ends here.'), head()], null)
    expect(linked.units.map((item) => item.fragments.length)).toEqual([1, 1])
  })

  it('ページをまたいで続く段落を、つなぐ。次のページでは、取り込まれた段落を除く', () => {
    const pageOne = [body, tail(undefined, { x: 50 })]
    const pageTwo = [
      unit('head2', 'corpus of documents. It works.', { x: 50, y: 80, atColumnTop: true, pageNumber: 2 }),
      unit('rest2', 'Another paragraph.', { x: 50, y: 200, pageNumber: 2 }),
    ]
    const first = linkPage(null, pageOne, pageTwo)
    expect(first.units.map((item) => item.id)).toEqual(['body', 'tail'])
    expect(first.units[1]?.fragments.map((fragment) => fragment.pageNumber)).toEqual([1, 2])

    const second = linkPage(pageOne, pageTwo, null)
    expect([...second.absorbed]).toEqual(['head2'])
    expect(second.units.map((item) => item.id)).toEqual(['rest2'])
  })

  it('2 段組では、右の段のいちばん下の段落だけが、次のページへ続く', () => {
    // 左の段のいちばん下の段落は、同じページの右の段へ続く。次のページへは続かない。
    const leftTail = tail()
    const rightTop = head('corpus of documents.', { atColumnBottom: false })
    const rightTail = unit('rightTail', 'The second paragraph is also', { x: 300, y: 600, atColumnBottom: true })
    const nextPage = [unit('head2', 'left unfinished at the page end.', { x: 50, y: 80, atColumnTop: true, pageNumber: 2 })]
    const linked = linkPage(null, [leftTail, rightTop, rightTail], nextPage)
    expect(linked.units.map((item) => [item.id, item.fragments.length])).toEqual([
      ['tail', 2],
      ['rightTail', 2],
    ])
    expect(linked.units[1]?.source).toBe('The second paragraph is also left unfinished at the page end.')
  })

  it('次のページの最も左の段のいちばん上へ続く', () => {
    const pageTwo = [
      unit('right2', 'the right column top.', { x: 300, y: 80, atColumnTop: true, pageNumber: 2 }),
      unit('left2', 'the left column top.', { x: 50, y: 80, atColumnTop: true, pageNumber: 2 }),
    ]
    const linked = linkPage(null, [tail(undefined, { x: 300 })], pageTwo)
    expect(linked.units[0]?.source).toBe('The model is trained on a large the left column top.')
  })

  it('前後のページが無い場合は、ページの中だけで判定する', () => {
    const linked = linkPage(null, [tail()], null)
    expect(linked.units.map((item) => item.fragments.length)).toEqual([1])
    expect(linked.absorbed.size).toBe(0)
  })
})
