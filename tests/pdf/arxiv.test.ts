import { describe, expect, it } from 'vitest'
import { arxivPdfUrl, parseArxivId } from '../../src/pdf/arxiv.ts'

describe('parseArxivId', () => {
  it.each([
    ['1706.03762', '1706.03762'],
    [' 2401.01234v2 ', '2401.01234v2'],
    ['arXiv:1512.03385', '1512.03385'],
    ['hep-th/9901001', 'hep-th/9901001'],
    ['https://arxiv.org/abs/1706.03762', '1706.03762'],
    ['https://arxiv.org/pdf/1706.03762v7.pdf', '1706.03762v7'],
    ['https://arxiv.org/pdf/1706.03762?download=1', '1706.03762'],
    ['http://www.arxiv.org/abs/math.GT/0309136', 'math.GT/0309136'],
  ])('%s から ID を取り出す', (input, expected) => {
    expect(parseArxivId(input)).toBe(expected)
  })

  it.each(['', 'attention is all you need', 'https://example.com/abs/1706.03762', '1706.3', '../../etc/passwd'])(
    '%s を ID として受け付けない',
    (input) => {
      expect(parseArxivId(input)).toBeNull()
    },
  )
})

describe('arxivPdfUrl', () => {
  it('PDF の URL を作る', () => {
    expect(arxivPdfUrl('1706.03762')).toBe('https://arxiv.org/pdf/1706.03762')
  })
})
