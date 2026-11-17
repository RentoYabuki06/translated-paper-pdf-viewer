import { describe, expect, it } from 'vitest'
import { duplicateColumns } from '../../src/viewer/compareColumns.ts'

describe('duplicateColumns', () => {
  it('すべての行で前の列と同じ列を、重複として返す', () => {
    const rows = [{ translations: ['あ', 'い', 'う', 'い'] }, { translations: ['か', 'き', 'く', 'き'] }]
    expect([...duplicateColumns(['0.8b', '2b', '8b', 'old'], rows)]).toEqual([['old', '2b']])
  })

  it('1 行でも違えば、重複にしない', () => {
    const rows = [{ translations: ['あ', 'あ'] }, { translations: ['か', 'き'] }]
    expect(duplicateColumns(['a', 'b'], rows).size).toBe(0)
  })

  it('訳文が保存されていない行は、どちらも無い場合にだけ、同じとみなす', () => {
    expect(duplicateColumns(['a', 'b'], [{ translations: ['あ', null] }]).size).toBe(0)
    expect([...duplicateColumns(['a', 'b'], [{ translations: [null, null] }, { translations: ['あ', 'あ'] }])]).toEqual([['b', 'a']])
  })

  it('同じ列が 3 つあれば、あとの 2 つを、いちばん前の列の重複にする', () => {
    const rows = [{ translations: ['あ', 'あ', 'あ'] }]
    expect([...duplicateColumns(['a', 'b', 'c'], rows)]).toEqual([
      ['b', 'a'],
      ['c', 'a'],
    ])
  })

  it('行が無ければ、2 つ目以降の列は、すべて重複になる', () => {
    expect([...duplicateColumns(['a', 'b'], [])]).toEqual([['b', 'a']])
  })
})
