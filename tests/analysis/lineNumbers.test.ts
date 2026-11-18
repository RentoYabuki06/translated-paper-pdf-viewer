import { describe, expect, it } from 'vitest'
import { removeLineNumbers } from '../../src/analysis/lineNumbers.ts'
import { buildLines } from '../../src/analysis/lines.ts'
import type { TextRun } from '../../src/analysis/types.ts'
import { run } from './helpers.ts'

/** 右端を right にそろえた、小さい字の番号を作る。 */
function number(value: number, right: number, baseline: number, fontSize = 5): TextRun {
  const text = String(value)
  return run(text, right - text.length * fontSize * 0.5, baseline, { fontSize, fontName: 'Number' })
}

/** 本文の行(左端 72)と、その左の余白の行番号(右端 62)を、count 行分作る。 */
function numberedPage(count: number, first = 39, step = 1): TextRun[] {
  const runs: TextRun[] = []
  for (let index = 0; index < count; index += 1) {
    const baseline = 100 + index * 12
    runs.push(number(first + index * step, 62, baseline))
    runs.push(run(`body text of line ${index}`, 72, baseline))
  }
  return runs
}

describe('removeLineNumbers', () => {
  it('左の余白の行番号を取り除き、本文を残す', () => {
    const result = removeLineNumbers(numberedPage(8))
    expect(result).toHaveLength(8)
    expect(result.every((item) => item.text.startsWith('body text'))).toBe(true)
  })

  it('取り除いたあとの行には、番号が入らない', () => {
    const runs = numberedPage(4)
    expect(buildLines(runs)[0]?.text).toBe('39 body text of line 0')
    expect(buildLines(removeLineNumbers(runs)).map((line) => line.text)).toEqual([
      'body text of line 0',
      'body text of line 1',
      'body text of line 2',
      'body text of line 3',
    ])
  })

  it('桁数が変わっても、右端がそろっていれば 1 列とみなす', () => {
    const result = removeLineNumbers(numberedPage(6, 97))
    expect(result).toHaveLength(6)
  })

  it('5 行ごとに振られた番号も取り除く', () => {
    const runs: TextRun[] = []
    for (let index = 0; index < 20; index += 1) {
      const baseline = 100 + index * 12
      if ((index + 1) % 5 === 0) runs.push(number(index + 1, 62, baseline))
      runs.push(run('body text', 72, baseline))
    }
    expect(removeLineNumbers(runs)).toHaveLength(20)
  })

  it('右の余白の行番号も取り除く', () => {
    const runs: TextRun[] = []
    for (let index = 0; index < 6; index += 1) {
      const baseline = 100 + index * 12
      runs.push(run('body text', 72, baseline))
      runs.push(run(String(index + 1), 140, baseline, { fontSize: 5 }))
    }
    const result = removeLineNumbers(runs)
    expect(result).toHaveLength(6)
    expect(result.every((item) => item.text === 'body text')).toBe(true)
  })

  it('本文の中の数字は残す', () => {
    const runs = numberedPage(6)
    runs.push(run('2024', 200, 100), run('17', 200, 112), run('3', 200, 124))
    const result = removeLineNumbers(runs)
    expect(result.filter((item) => /^\d+$/.test(item.text)).map((item) => item.text)).toEqual(['2024', '17', '3'])
  })

  it('増え方がそろっていない数字の列は残す', () => {
    const runs: TextRun[] = []
    ;[12, 7, 30, 4, 19, 2].forEach((value, index) => {
      runs.push(number(value, 62, 100 + index * 12), run('body text', 72, 100 + index * 12))
    })
    expect(removeLineNumbers(runs)).toHaveLength(12)
  })

  it('左にほかの文字がある数字の列は残す', () => {
    const runs: TextRun[] = []
    for (let index = 0; index < 6; index += 1) {
      const baseline = 100 + index * 12
      runs.push(run('name', 30, baseline), number(index + 1, 62, baseline), run('value', 72, baseline))
    }
    expect(removeLineNumbers(runs)).toHaveLength(18)
  })

  it('ページの一部にしかない、表の通し番号の列は残す', () => {
    const runs: TextRun[] = []
    // 表の左端は、本文の左端と同じ位置にある。
    for (let index = 0; index < 5; index += 1) {
      runs.push(run(String(index + 1), 72, 100 + index * 12), run('cell', 100, 100 + index * 12))
    }
    for (let index = 0; index < 40; index += 1) runs.push(run('body text of the page', 72, 200 + index * 12))
    expect(removeLineNumbers(runs)).toHaveLength(50)
  })

  it('図の多いページで、行番号が一部にしかなくても、ほかのどの文字よりも外側にあれば取り除く', () => {
    const runs: TextRun[] = []
    for (let index = 0; index < 30; index += 1) runs.push(run('label in a figure', 90, 100 + index * 12))
    for (let index = 0; index < 5; index += 1) {
      const baseline = 500 + index * 12
      runs.push(number(146 + index, 62, baseline), run('caption text', 72, baseline))
    }
    const result = removeLineNumbers(runs)
    expect(result).toHaveLength(35)
    expect(result.some((item) => /^\d+$/.test(item.text))).toBe(false)
  })

  it('回転した文字は、判定に使わず、そのまま残す', () => {
    const runs = numberedPage(6)
    runs.push(run('arXiv:0000.00000', 20, 150, { rotated: true }))
    const result = removeLineNumbers(runs)
    expect(result).toHaveLength(7)
    expect(result.some((item) => item.rotated)).toBe(true)
  })

  it('数字のまとまりが少ないページは、何も取り除かない', () => {
    const runs = [number(1, 62, 100), run('body', 72, 100), number(2, 62, 112), run('body', 72, 112)]
    expect(removeLineNumbers(runs)).toHaveLength(4)
  })
})
