import { describe, expect, it } from 'vitest'
import { checkTranslation, encodeSentence, isPlaceholderFormat, normalizeTags } from '../../scripts/lib/placeholderFormats.ts'

const sentence = {
  template: 'Let {0} denote the embedding of the {1}-th token.',
  math: ['xi ∈ Rd', 'i'],
}

describe('encodeSentence', () => {
  it('bare: 数式を番号だけの目印に置き換える', () => {
    expect(encodeSentence(sentence, 'bare')).toEqual({
      source: 'Let <m1> denote the embedding of the <m2>-th token.',
      glossary: [],
      slotCount: 2,
    })
  })

  it('paired: 数式の文字を対の目印で包む', () => {
    expect(encodeSentence(sentence, 'paired')).toEqual({
      source: 'Let <m1>xi ∈ Rd</m1> denote the embedding of the <m2>i</m2>-th token.',
      glossary: [],
      slotCount: 2,
    })
  })

  it('bare+pin: 目印をそのまま残す指定を用語集に入れる', () => {
    const encoded = encodeSentence(sentence, 'bare+pin')
    expect(encoded.source).toBe('Let <m1> denote the embedding of the <m2>-th token.')
    expect(encoded.glossary).toEqual([
      { source: '<m1>', target: '<m1>' },
      { source: '<m2>', target: '<m2>' },
    ])
  })

  it('paired+pin: 開く側と閉じる側の両方を用語集に入れる', () => {
    const encoded = encodeSentence(sentence, 'paired+pin')
    expect(encoded.source).toBe('Let <m1>xi ∈ Rd</m1> denote the embedding of the <m2>i</m2>-th token.')
    expect(encoded.glossary).toEqual([
      { source: '<m1>', target: '<m1>' },
      { source: '</m1>', target: '</m1>' },
      { source: '<m2>', target: '<m2>' },
      { source: '</m2>', target: '</m2>' },
    ])
  })

  it('数式の文字に含まれる山括弧は、目印と紛れない文字に置き換える', () => {
    const encoded = encodeSentence({ template: 'Assume {0}.', math: ['a < b > c'] }, 'paired')
    expect(encoded.source).toBe('Assume <m1>a ‹ b › c</m1>.')
  })
})

describe('checkTranslation(番号だけの書式)', () => {
  it('すべての目印がちょうど 1 回ずつあれば合格', () => {
    expect(checkTranslation('<m2>番目のトークンの埋め込みを<m1>とする。', 2, 'bare')).toEqual({ ok: true, problems: [] })
  })

  it('目印が欠けている', () => {
    expect(checkTranslation('トークンの埋め込みを<m1>とする。', 2, 'bare').problems).toEqual(['m2:missing'])
  })

  it('目印が重複している', () => {
    expect(checkTranslation('<m1>と<m1>と<m2>。', 2, 'bare').problems).toEqual(['m1:duplicated'])
  })

  it('原文に無い番号の目印がある', () => {
    expect(checkTranslation('<m1>と<m2>と<m3>。', 2, 'bare').problems).toEqual(['m3:unknown'])
  })

  it('閉じる側の目印が現れた', () => {
    expect(checkTranslation('<m1>x</m1>と<m2>。', 2, 'bare').problems).toEqual(['m1:unexpected-close'])
  })

  it('目印が 1 つも無い文は、目印の数が 0 なら合格', () => {
    expect(checkTranslation('目印の無い訳文である。', 0, 'bare').ok).toBe(true)
  })
})

describe('checkTranslation(対の書式)', () => {
  it('開く側と閉じる側がちょうど 1 回ずつ、順番どおりにあれば合格', () => {
    expect(checkTranslation('<m2>i</m2>番目の埋め込みを<m1>xi ∈ Rd</m1>とする。', 2, 'paired').ok).toBe(true)
  })

  it('閉じる側が欠けている', () => {
    expect(checkTranslation('<m1>x とする。<m2>i</m2>', 2, 'paired').problems).toEqual(['m1:unclosed'])
  })

  it('開く側が欠けている', () => {
    expect(checkTranslation('x</m1> とする。<m2>i</m2>', 2, 'paired').problems).toEqual(['m1:missing'])
  })

  it('閉じる側が開く側より前にある', () => {
    expect(checkTranslation('</m1>x<m1> とする。', 1, 'paired').problems).toEqual(['m1:order'])
  })

  it('閉じる側が重複している', () => {
    expect(checkTranslation('<m1>x</m1></m1>', 1, 'paired').problems).toEqual(['m1:duplicated-close'])
  })

  it('目印どうしが入れ子になっている', () => {
    expect(checkTranslation('<m1>x<m2>i</m2></m1>', 2, 'paired').problems).toEqual(['structure'])
  })

  it('目印どうしが交差している', () => {
    expect(checkTranslation('<m1>x<m2>i</m1>y</m2>', 2, 'paired').problems).toEqual(['structure'])
  })
})

describe('normalizeTags', () => {
  it('全角の山括弧とスラッシュを半角にする', () => {
    expect(normalizeTags('＜m1＞x＜／m1＞')).toBe('<m1>x</m1>')
  })

  it('目印の内側の空白を取り除き、英字を小文字にそろえる', () => {
    expect(normalizeTags('< m1 >x< / M1 >')).toBe('<m1>x</m1>')
  })

  it('目印でない山括弧は変更しない', () => {
    expect(normalizeTags('a < b と <em>強調</em>')).toBe('a < b と <em>強調</em>')
  })

  it('直したあとの訳文は、厳密な検査に合格する', () => {
    const translation = '＜m1＞x＜/m1＞ とする。'
    expect(checkTranslation(translation, 1, 'paired').ok).toBe(false)
    expect(checkTranslation(normalizeTags(translation), 1, 'paired').ok).toBe(true)
  })
})

describe('isPlaceholderFormat', () => {
  it('候補の 4 種類だけを受け付ける', () => {
    expect(isPlaceholderFormat('paired+pin')).toBe(true)
    expect(isPlaceholderFormat('curly')).toBe(false)
  })
})
