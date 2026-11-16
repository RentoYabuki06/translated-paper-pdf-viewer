import { describe, expect, it } from 'vitest'
import { spriteStyle } from '../../src/overlay/sprite.ts'

const PAGE = { url: 'blob:page', width: 600, height: 800 }

/** "1.5em" のような文字列から、数値を取り出す。 */
function em(value: string): number {
  return Number(value.replace(/em$/, ''))
}

describe('spriteStyle', () => {
  it('数式の範囲を、文字の大きさを 1 とする単位で指定する', () => {
    // 基準線は y = 100。数式は、基準線の上 7 ポイントから、下 2 ポイントまで。
    const style = spriteStyle({ x: 50, y: 93, width: 20, height: 9, baseline: 100 }, 10, PAGE)
    expect(style.width).toBe('2em')
    expect(style.height).toBe('0.9em')
    expect(style.backgroundImage).toBe('url("blob:page")')
    expect(style.backgroundSize).toBe('60em 80em')
    expect(style.backgroundPosition).toBe('-5em -9.3em')
    // 行の高さを広げない範囲に収まっているので、余白は削らない。下端は、基準線の 0.2 文字分だけ下。
    expect(em(style.marginTop)).toBeCloseTo(0)
    expect(em(style.marginBottom)).toBeCloseTo(0)
    expect(em(style.verticalAlign)).toBeCloseTo(-0.2)
  })

  it('添字が少しはみ出す数式は、はみ出した分を行の高さに数えない', () => {
    // 基準線の上 10.5 ポイント、下 3.2 ポイント。上は 0.1 文字分、下も 0.1 文字分はみ出す。
    const style = spriteStyle({ x: 0, y: 89.5, width: 10, height: 13.7, baseline: 100 }, 10, PAGE)
    expect(em(style.marginTop)).toBeCloseTo(-0.1)
    expect(em(style.marginBottom)).toBeCloseTo(-0.1)
    // 余白を含めた下端で位置が決まるので、削った分だけ上げる。数式そのものの下端は、基準線の 0.32 文字分だけ下のまま。
    expect(em(style.verticalAlign)).toBeCloseTo(-0.22)
  })

  it('分数のように大きくはみ出す数式は、上限を超えた分だけ行の高さを広げる', () => {
    // 基準線の上 14 ポイント、下 8 ポイント。
    const style = spriteStyle({ x: 0, y: 86, width: 10, height: 22, baseline: 100 }, 10, PAGE)
    expect(em(style.marginTop)).toBeCloseTo(-0.22)
    expect(em(style.marginBottom)).toBeCloseTo(-0.22)
    expect(em(style.verticalAlign)).toBeCloseTo(-0.58)
  })

  it('画像がまだ無い場合は、背景の画像を指定しない', () => {
    const style = spriteStyle({ x: 0, y: 93, width: 10, height: 9, baseline: 100 }, 10, { ...PAGE, url: null })
    expect(style.backgroundImage).toBeUndefined()
  })
})
