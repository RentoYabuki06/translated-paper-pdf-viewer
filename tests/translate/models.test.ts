import { describe, expect, it } from 'vitest'
import {
  candidateModelIds,
  isModelSize,
  launcherModelIds,
  modelAlias,
  normalizeKnownModels,
  shortModelLabel,
} from '../../src/translate/models.ts'

describe('modelAlias と launcherModelIds', () => {
  it('別名に、大きさと量子化の種類を含める', () => {
    expect(modelAlias('8b', 'Q4_K_M')).toBe('plamo-3-translate-8b-Q4_K_M')
  })

  it('既定の量子化の種類での別名を、大きさの小さい順に返す', () => {
    expect(launcherModelIds()).toEqual([
      'plamo-3-translate-0.8b-Q4_K_M',
      'plamo-3-translate-2b-Q4_K_M',
      'plamo-3-translate-8b-Q4_K_M',
      'plamo-3-translate-31b-Q4_K_M',
    ])
  })

  it('公開されている大きさだけを受け付ける', () => {
    expect(isModelSize('0.8b')).toBe(true)
    expect(isModelSize('4b')).toBe(false)
  })
})

describe('shortModelLabel', () => {
  it('npm run model が付けた別名は、大きさだけにする', () => {
    expect(shortModelLabel('plamo-3-translate-8b-Q4_K_M')).toBe('8b')
    expect(shortModelLabel('plamo-3-translate-0.8b-Q4_K_M')).toBe('0.8b')
  })

  it('既定でない量子化の種類は、かっこで足す', () => {
    expect(shortModelLabel('plamo-3-translate-2b-Q3_K_M')).toBe('2b(Q3_K_M)')
  })

  it('それ以外の名前は、そのまま返す', () => {
    expect(shortModelLabel('plamo-3-translate')).toBe('plamo-3-translate')
    expect(shortModelLabel('plamo-3-translate-2b:latest')).toBe('plamo-3-translate-2b:latest')
  })
})

describe('normalizeKnownModels', () => {
  it('配列でない値からは、空の並びを返す', () => {
    expect(normalizeKnownModels(null)).toEqual([])
    expect(normalizeKnownModels('plamo')).toEqual([])
  })

  it('文字列でない要素、空の文字列、重複を取り除く', () => {
    expect(normalizeKnownModels(['a', 1, '', 'b', 'a', null, ' '])).toEqual(['a', 'b'])
  })

  it('数が多すぎる場合は、前から 20 件までにする', () => {
    const names = Array.from({ length: 30 }, (_, index) => `model-${index}`)
    expect(normalizeKnownModels(names)).toEqual(names.slice(0, 20))
  })
})

describe('candidateModelIds', () => {
  it('npm run model の別名のあとに、使ったことのある名前を、重複なく並べる', () => {
    expect(candidateModelIds(['plamo-3-translate-2b:latest', 'plamo-3-translate-8b-Q4_K_M', 'plamo-3-translate'])).toEqual([
      ...launcherModelIds(),
      'plamo-3-translate-2b:latest',
      'plamo-3-translate',
    ])
  })

  it('使ったことのある名前が無ければ、npm run model の別名だけを返す', () => {
    expect(candidateModelIds([])).toEqual(launcherModelIds())
  })
})
