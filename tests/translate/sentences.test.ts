import { describe, expect, it } from 'vitest'
import { splitSentences } from '../../src/translate/sentences.ts'

describe('splitSentences', () => {
  it('ピリオド、疑問符、感嘆符のあとで分ける', () => {
    expect(splitSentences('We propose a model. Does it work? Yes! It does.')).toEqual([
      'We propose a model.',
      'Does it work?',
      'Yes!',
      'It does.',
    ])
  })

  it('略語のピリオドでは分けない', () => {
    expect(splitSentences('As shown in Fig. 2, it works (cf. Sec. 3). See Eq. (1) for details.')).toEqual([
      'As shown in Fig. 2, it works (cf. Sec. 3).',
      'See Eq. (1) for details.',
    ])
    expect(splitSentences('Some models, e.g. ResNets, are deep. He et al. [3] showed this.')).toEqual([
      'Some models, e.g. ResNets, are deep.',
      'He et al. [3] showed this.',
    ])
  })

  it('人名の頭文字のピリオドでは分けない', () => {
    expect(splitSentences('The method of J. Smith is used. It is fast.')).toEqual(['The method of J. Smith is used.', 'It is fast.'])
  })

  it('小数点や、小文字が続くピリオドでは分けない', () => {
    expect(splitSentences('The rate is 0.5 and vs. the baseline it gains 3.2 points.')).toEqual([
      'The rate is 0.5 and vs. the baseline it gains 3.2 points.',
    ])
  })

  it('数式の目印で始まる文の前で分ける', () => {
    expect(splitSentences('We set <m1>. <m2> is the output. Then (see below) we stop.')).toEqual([
      'We set <m1>.',
      '<m2> is the output.',
      'Then (see below) we stop.',
    ])
  })

  it('閉じる側の引用符と括弧を、前の文に含める', () => {
    expect(splitSentences('He said "stop." Then (it ended.) Done.')).toEqual(['He said "stop."', 'Then (it ended.)', 'Done.'])
  })

  it('分けるところが無ければ、全体を 1 つの文として返す', () => {
    expect(splitSentences('  no terminator here  ')).toEqual(['no terminator here'])
    expect(splitSentences('')).toEqual([])
  })
})
