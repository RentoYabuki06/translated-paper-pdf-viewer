import { describe, expect, it } from 'vitest'
import { pagePriority, PriorityQueue } from '../../src/translate/queue.ts'

/** あとから手で完了させられる処理を作る。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('PriorityQueue', () => {
  it('同時に処理する数を守り、優先度の値が小さい順に処理する', async () => {
    const started: number[] = []
    const gates = new Map<number, ReturnType<typeof deferred>>()
    const queue = new PriorityQueue<number>({
      concurrency: 2,
      priority: (item) => item,
      worker: (item) => {
        started.push(item)
        const gate = deferred()
        gates.set(item, gate)
        return gate.promise
      },
    })

    queue.add([5, 1, 4, 2, 3])
    expect(started).toEqual([1, 2])
    gates.get(1)?.resolve()
    await tick()
    expect(started).toEqual([1, 2, 3])
    gates.get(2)?.resolve()
    gates.get(3)?.resolve()
    await tick()
    expect(started).toEqual([1, 2, 3, 4, 5])
  })

  it('優先度を、処理を始める時点で計算し直す', async () => {
    const started: number[] = []
    const gates = new Map<number, ReturnType<typeof deferred>>()
    let focus = 1
    const queue = new PriorityQueue<number>({
      concurrency: 1,
      priority: (page) => pagePriority(page, focus),
      worker: (page) => {
        started.push(page)
        const gate = deferred()
        gates.set(page, gate)
        return gate.promise
      },
    })

    queue.add([1, 2, 3, 4])
    focus = 3
    gates.get(1)?.resolve()
    await tick()
    gates.get(3)?.resolve()
    await tick()
    expect(started).toEqual([1, 3, 4])
  })

  it('1 件が失敗しても、ほかの項目を処理し、最後に onIdle を呼ぶ', async () => {
    const done: number[] = []
    let idle = 0
    const queue = new PriorityQueue<number>({
      concurrency: 1,
      priority: (item) => item,
      worker: async (item) => {
        if (item === 1) throw new Error('失敗')
        done.push(item)
      },
      onIdle: () => {
        idle += 1
      },
    })
    queue.add([1, 2])
    await tick()
    await tick()
    expect(done).toEqual([2])
    expect(idle).toBe(1)
    expect(queue.size).toBe(0)
  })

  it('取り消すと、待っている項目を処理せず、処理中の項目に合図を送る', async () => {
    const started: number[] = []
    let aborted = false
    const gate = deferred()
    const queue = new PriorityQueue<number>({
      concurrency: 1,
      priority: (item) => item,
      worker: (item, signal) => {
        started.push(item)
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return gate.promise
      },
    })
    queue.add([1, 2])
    queue.cancel()
    gate.resolve()
    await tick()
    queue.add([3])
    expect(started).toEqual([1])
    expect(aborted).toBe(true)
  })
})

describe('pagePriority', () => {
  it('表示中のページ、後ろのページ、前のページの順に並べる', () => {
    const pages = [1, 2, 3, 4, 5, 6]
    const ordered = [...pages].sort((a, b) => pagePriority(a, 3) - pagePriority(b, 3))
    expect(ordered).toEqual([3, 4, 5, 6, 2, 1])
  })
})
