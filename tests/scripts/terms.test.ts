import { describe, expect, it } from 'vitest'
import { checkTerms, describeTermCheck } from '../../scripts/lib/terms.ts'

describe('checkTerms', () => {
  it('含まれているはずの文字列がすべてあり、避けたい文字列が無ければ ok', () => {
    expect(checkTerms('注意を用いて重みを付ける。', ['注意'], ['アテンション'])).toEqual({ ok: true, missing: [], unwanted: [] })
  })

  it('含まれているはずの文字列が無ければ、missing に入れる', () => {
    expect(checkTerms('アテンションを用いる。', ['注意', '字句'], [])).toEqual({ ok: false, missing: ['注意', '字句'], unwanted: [] })
  })

  it('避けたい文字列があれば、unwanted に入れる', () => {
    expect(checkTerms('注意とアテンションを用いる。', ['注意'], ['アテンション', '損失'])).toEqual({
      ok: false,
      missing: [],
      unwanted: ['アテンション'],
    })
  })

  it('調べる文字列が 1 つも無ければ ok', () => {
    expect(checkTerms('どんな訳文でも。', [], []).ok).toBe(true)
  })
})

describe('describeTermCheck', () => {
  it('指定どおりの場合', () => {
    expect(describeTermCheck({ ok: true, missing: [], unwanted: [] })).toBe('指定どおり')
  })

  it('指定と違う場合は、足りない文字列と、残っている文字列を並べる', () => {
    expect(describeTermCheck({ ok: false, missing: ['注意'], unwanted: ['アテンション'] })).toBe(
      '指定と違う: 「注意」が無い、「アテンション」がある',
    )
  })
})
