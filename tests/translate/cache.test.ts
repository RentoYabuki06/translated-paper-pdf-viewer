import { describe, expect, it } from 'vitest'
import { cacheKey, cacheKeySource } from '../../src/translate/cache.ts'

const request = { source: 'Hello.', sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: 1024 } as const

describe('cacheKey', () => {
  it('同じモデルと同じ依頼からは、同じ鍵を作る', async () => {
    expect(await cacheKey('plamo', request)).toBe(await cacheKey('plamo', { ...request }))
    expect(await cacheKey('plamo', request)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('モデル、原文、文体、長さの上限のどれかが違えば、鍵が変わる', async () => {
    const base = await cacheKey('plamo', request)
    expect(await cacheKey('other', request)).not.toBe(base)
    expect(await cacheKey('plamo', { ...request, source: 'Hello!' })).not.toBe(base)
    expect(await cacheKey('plamo', { ...request, form: 'polite' })).not.toBe(base)
    expect(await cacheKey('plamo', { ...request, maxTokens: 512 })).not.toBe(base)
  })

  it('鍵のもとになる文字列に、依頼の文字列全体を含める', () => {
    expect(cacheKeySource('plamo', request)).toContain('Hello.')
  })
})
