import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../../src/lib/pool.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('mapWithConcurrency', () => {
  it('結果を入力と同じ順番で返す', async () => {
    // 後ろの要素ほど早く終わるようにして、完了の順番と入力の順番をずらす。
    const results = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms, index) => {
      await sleep(ms)
      return `${index}:${ms}`
    })
    expect(results).toEqual(['0:30', '1:20', '2:10', '3:0'])
  })

  it('同時に実行する数が上限を超えない', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      running += 1
      peak = Math.max(peak, running)
      await sleep(5)
      running -= 1
    })
    expect(peak).toBe(3)
  })

  it('要素数が上限より少なくても動く', async () => {
    expect(await mapWithConcurrency([1, 2], 8, async (value) => value * 2)).toEqual([2, 4])
    expect(await mapWithConcurrency([], 8, async (value: number) => value)).toEqual([])
  })

  it('1 件でも失敗したら全体を失敗にする', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error('2 件目で失敗')
        return value
      }),
    ).rejects.toThrow('2 件目で失敗')
  })

  it('不正な同時実行数はエラーにする', async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow()
    await expect(mapWithConcurrency([1], 1.5, async (value) => value)).rejects.toThrow()
  })
})
