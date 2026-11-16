import { describe, expect, it } from 'vitest'
import { buildAtoms, canBreakBefore } from '../../src/overlay/atoms.ts'
import type { Atom } from '../../src/overlay/atoms.ts'
import type { MathSlot } from '../../src/analysis/source.ts'

function slot(id: number, parts = 1): MathSlot {
  return {
    id,
    text: `x${id}`,
    parts: Array.from({ length: parts }, (_, index) => ({ pageNumber: 1, x: index * 10, y: 0, width: 10, height: 10, baseline: 8 })),
  }
}

/** 単位の並びを、短い文字列にする。数式は [番号] で表す。 */
function show(atoms: Atom[]): string {
  return atoms.map((atom) => (atom.type === 'char' ? atom.text : `[${atom.title}]`)).join('')
}

describe('buildAtoms', () => {
  it('文章を 1 文字ずつ、数式を 1 つずつの単位にする', () => {
    const atoms = buildAtoms('関数<m1>は', [slot(1)])
    expect(atoms).toHaveLength(4)
    expect(show(atoms)).toBe('関数[x1]は')
  })

  it('数式の前後の空白を取り除く', () => {
    expect(show(buildAtoms('関数 <m1> と <m2> は', [slot(1), slot(2)]))).toBe('関数[x1]と[x2]は')
  })

  it('行をまたぐ数式は、行ごとの部分を、続けて並べる', () => {
    const atoms = buildAtoms('和<m1>を', [slot(1, 2)])
    expect(atoms.filter((atom) => atom.type === 'math')).toHaveLength(2)
  })

  it('対応する数式が無い目印は、何も出さない', () => {
    expect(show(buildAtoms('値<m5>です', [slot(1)]))).toBe('値です')
  })

  it('サロゲートペアの文字を、1 つの単位にする', () => {
    expect(buildAtoms('𝑥は', [])).toHaveLength(2)
  })
})

describe('canBreakBefore', () => {
  const atoms = buildAtoms('これは(ImageNet)で、3.5%です。', [])
  const breakable = (text: string) => canBreakBefore(atoms, show(atoms).indexOf(text))

  it('ふつうの文字の間では、分けてよい', () => {
    expect(breakable('は(')).toBe(true)
    expect(breakable('です')).toBe(true)
  })

  it('句読点と閉じ括弧の直前では、分けない', () => {
    expect(breakable('、')).toBe(false)
    expect(breakable('。')).toBe(false)
    expect(breakable(')で')).toBe(false)
  })

  it('開き括弧の直後では、分けない', () => {
    expect(breakable('ImageNet')).toBe(false)
  })

  it('英数字の語の途中では、分けない', () => {
    expect(breakable('mageNet')).toBe(false)
    expect(breakable('.5%')).toBe(false)
    expect(breakable('%です')).toBe(false)
  })

  it('数式の前後では、分けてよい', () => {
    const withMath = buildAtoms('値<m1>は', [slot(1)])
    expect(canBreakBefore(withMath, 1)).toBe(true)
    expect(canBreakBefore(withMath, 2)).toBe(true)
  })

  it('端では、分けてよい', () => {
    expect(canBreakBefore(atoms, 0)).toBe(true)
    expect(canBreakBefore(atoms, atoms.length)).toBe(true)
  })
})
