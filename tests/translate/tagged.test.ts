import { describe, expect, it } from 'vitest'
import { translateTagged } from '../../src/translate/tagged.ts'

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
