import { describe, expect, it } from 'vitest'
import { splitParagraphs } from '../../src/translate/splitParagraphs.ts'

describe('splitParagraphs', () => {
  it('空行で段落に分ける', () => {
    expect(splitParagraphs('First paragraph.\n\nSecond paragraph.')).toEqual(['First paragraph.', 'Second paragraph.'])
  })

  it('段落の中の改行を空白 1 つに置き換える', () => {
    expect(splitParagraphs('We propose a\nnew method\nfor translation.')).toEqual([
      'We propose a new method for translation.',
    ])
  })

  it('空白だけの行と、連続する空行も区切りとして扱う', () => {
    expect(splitParagraphs('A\n  \t\nB\n\n\n\nC')).toEqual(['A', 'B', 'C'])
  })

  it('CRLF の改行を扱う', () => {
    expect(splitParagraphs('A\r\nB\r\n\r\nC')).toEqual(['A B', 'C'])
  })

  it('前後の空白と空の入力を取り除く', () => {
    expect(splitParagraphs('\n\n  A  \n\n')).toEqual(['A'])
    expect(splitParagraphs('  \n \n')).toEqual([])
  })
})
