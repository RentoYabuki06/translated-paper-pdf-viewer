import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime, MAX_HISTORY, overflowIds, sortEntries } from '../../src/viewer/history.ts'
import type { HistoryEntry } from '../../src/viewer/history.ts'

function entry(id: string, openedAt: number): HistoryEntry {
  return { id, name: `${id}.pdf`, pages: 10, bytes: 1000, openedAt }
}

describe('sortEntries', () => {
  it('最後に開いた時刻の新しい順に並べる', () => {
    const sorted = sortEntries([entry('a', 10), entry('b', 30), entry('c', 20)])
    expect(sorted.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('渡した並びは変えない', () => {
    const entries = [entry('a', 10), entry('b', 30)]
    sortEntries(entries)
    expect(entries.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('overflowIds', () => {
  it('上限以下なら、何も消さない', () => {
    expect(overflowIds([entry('a', 10), entry('b', 30)], 2)).toEqual([])
  })

  it('上限を超えた分を、古いものから選ぶ', () => {
    expect(overflowIds([entry('a', 10), entry('b', 30), entry('c', 20), entry('d', 5)], 2)).toEqual(['a', 'd'])
  })

  it('既定の上限は MAX_HISTORY', () => {
    const entries = Array.from({ length: MAX_HISTORY + 1 }, (_, index) => entry(`e${index}`, index))
    expect(overflowIds(entries)).toEqual(['e0'])
  })
})

describe('formatBytes', () => {
  it('1 MB 以上は MB、それ未満は KB で表す', () => {
    expect(formatBytes(2_215_244)).toBe('2.2 MB')
    expect(formatBytes(1_000_000)).toBe('1.0 MB')
    expect(formatBytes(512_400)).toBe('512 KB')
    expect(formatBytes(200)).toBe('1 KB')
  })
})

describe('formatTime', () => {
  it('年月日と、時刻を表す', () => {
    expect(formatTime(new Date(2026, 10, 7, 9, 5).getTime())).toBe('2026/11/7 09:05')
  })
})
