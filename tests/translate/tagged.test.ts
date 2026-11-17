import { describe, expect, it } from 'vitest'
import { translateTagged, translateTaggedWithGlossary } from '../../src/translate/tagged.ts'

/** 原文ごとに決めた訳文を返す、にせの依頼の関数を作る。呼ばれた原文を記録する。 */
function fake(answers: Record<string, string>, truncated: string[] = []) {
  const calls: string[] = []
  const request = async (source: string) => {
    calls.push(source)
    return { text: answers[source] ?? '', truncated: truncated.includes(source) }
  }
  return { calls, request }
}

const SOURCE = 'We set <m1> first. Then <m2> is used.'

describe('translateTagged', () => {
  it('目印がそろっていれば、訳文をそのまま採用する', async () => {
    const { calls, request } = fake({ [SOURCE]: 'まず<m1>とする。次に<m2>を使う。' })
    expect(await translateTagged(SOURCE, request)).toEqual({
      status: 'ok',
      text: 'まず<m1>とする。次に<m2>を使う。',
      truncated: false,
      retried: false,
    })
    expect(calls).toEqual([SOURCE])
  })

  it('目印を含まない原文は、検査をせずに採用する', async () => {
    const { request } = fake({ 'Plain text.': '普通の文。' })
    expect(await translateTagged('Plain text.', request)).toMatchObject({ status: 'ok', text: '普通の文。' })
  })

  it('目印がそろわなければ、文ごとに訳し直してつなぐ', async () => {
    const { calls, request } = fake({
      [SOURCE]: 'まず<m1>とする。次に使う。',
      'We set <m1> first.': 'まず<m1>とする。',
      'Then <m2> is used.': '次に<m2>を使う。',
    })
    expect(await translateTagged(SOURCE, request)).toEqual({
      status: 'ok',
      text: 'まず<m1>とする。次に<m2>を使う。',
      truncated: false,
      retried: true,
    })
    expect(calls).toEqual([SOURCE, 'We set <m1> first.', 'Then <m2> is used.'])
  })

  it('文ごとに訳し直してもそろわなければ、訳文を採用しない', async () => {
    const { request } = fake({
      [SOURCE]: 'まず<m1>とする。',
      'We set <m1> first.': 'まず<m1>とする。',
      'Then <m2> is used.': '次に使う。',
    })
    expect(await translateTagged(SOURCE, request)).toEqual({ status: 'kept' })
  })

  it('訳し直した文が途中で切れた場合は、訳文を採用しない', async () => {
    const { request } = fake(
      {
        [SOURCE]: '',
        'We set <m1> first.': 'まず<m1>とする。',
        'Then <m2> is used.': '次に<m2>を',
      },
      ['Then <m2> is used.'],
    )
    expect(await translateTagged(SOURCE, request)).toEqual({ status: 'kept' })
  })

  it('文に分けられない原文は、訳し直さない', async () => {
    const { calls, request } = fake({ 'Only <m1> here': '目印が無い訳文' })
    expect(await translateTagged('Only <m1> here', request)).toEqual({ status: 'kept' })
    expect(calls).toHaveLength(1)
  })

  it('目印が重複した訳文も、そろっていないとみなす', async () => {
    const { request } = fake({ 'Only <m1> here': '<m1>と<m1>' })
    expect(await translateTagged('Only <m1> here', request)).toEqual({ status: 'kept' })
  })
})

/**
 * 用語集を付けた場合(guided)と付けない場合(plain)で、原文ごとに決めた訳文を返す、にせの依頼の関数を作る。
 * 呼ばれた原文を、用語集を付けたかどうかの印(G か N)と一緒に記録する。
 */
function fakeWithGlossary(guided: Record<string, string>, plain: Record<string, string>) {
  const calls: string[] = []
  const request = async (source: string, withGlossary: boolean) => {
    calls.push(`${withGlossary ? 'G' : 'N'}: ${source}`)
    return { text: (withGlossary ? guided : plain)[source] ?? '', truncated: false }
  }
  return { calls, request }
}

describe('translateTaggedWithGlossary', () => {
  it('用語集を付けた訳文の目印がそろっていれば、そのまま採用する', async () => {
    const { calls, request } = fakeWithGlossary({ [SOURCE]: 'まず<m1>を置く。次に<m2>を使う。' }, {})
    expect(await translateTaggedWithGlossary(SOURCE, true, request)).toEqual({
      status: 'ok',
      text: 'まず<m1>を置く。次に<m2>を使う。',
      truncated: false,
      retried: false,
      glossaryDropped: false,
    })
    expect(calls).toEqual([`G: ${SOURCE}`])
  })

  it('用語集を付けて文ごとに訳し直すとそろう場合は、用語集を付けたまま採用する', async () => {
    const { calls, request } = fakeWithGlossary(
      {
        [SOURCE]: 'まず<m1>を置く。次に使う。',
        'We set <m1> first.': 'まず<m1>を置く。',
        'Then <m2> is used.': '次に<m2>を使う。',
      },
      {},
    )
    expect(await translateTaggedWithGlossary(SOURCE, true, request)).toMatchObject({
      status: 'ok',
      text: 'まず<m1>を置く。次に<m2>を使う。',
      retried: true,
      glossaryDropped: false,
    })
    expect(calls.every((call) => call.startsWith('G: '))).toBe(true)
  })

  it('用語集を付けるとそろわず、付けなければそろう場合は、付けない訳文を採用する', async () => {
    const { calls, request } = fakeWithGlossary(
      {
        [SOURCE]: 'まず<m1>を置く。次に使う。',
        'We set <m1> first.': 'まず<m1>を置く。',
        'Then <m2> is used.': '次に使う。',
      },
      { [SOURCE]: 'まず<m1>とする。次に<m2>を使う。' },
    )
    expect(await translateTaggedWithGlossary(SOURCE, true, request)).toEqual({
      status: 'ok',
      text: 'まず<m1>とする。次に<m2>を使う。',
      truncated: false,
      retried: false,
      glossaryDropped: true,
    })
    expect(calls).toEqual([`G: ${SOURCE}`, 'G: We set <m1> first.', 'G: Then <m2> is used.', `N: ${SOURCE}`])
  })

  it('用語集を付けずに文ごとに訳し直してそろった場合も、付けない訳文を採用する', async () => {
    const { request } = fakeWithGlossary(
      { [SOURCE]: '目印が無い訳文' },
      {
        [SOURCE]: 'まず<m1>とする。次に使う。',
        'We set <m1> first.': 'まず<m1>とする。',
        'Then <m2> is used.': '次に<m2>を使う。',
      },
    )
    expect(await translateTaggedWithGlossary(SOURCE, true, request)).toMatchObject({
      status: 'ok',
      text: 'まず<m1>とする。次に<m2>を使う。',
      retried: true,
      glossaryDropped: true,
    })
  })

  it('用語集を付けても付けなくてもそろわなければ、訳文を採用しない', async () => {
    const { request } = fakeWithGlossary({ [SOURCE]: '目印が無い訳文' }, { [SOURCE]: 'こちらも目印が無い' })
    expect(await translateTaggedWithGlossary(SOURCE, true, request)).toEqual({ status: 'kept' })
  })

  it('付ける用語集の項目が無い原文は、訳し直さない', async () => {
    const { calls, request } = fakeWithGlossary({ 'Only <m1> here': '目印が無い訳文' }, { 'Only <m1> here': '<m1>だけ' })
    expect(await translateTaggedWithGlossary('Only <m1> here', false, request)).toEqual({ status: 'kept' })
    expect(calls).toEqual(['G: Only <m1> here'])
  })
})
