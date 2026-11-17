import { describe, expect, it } from 'vitest'
import {
  checkRows,
  createGlossaryMatcher,
  describeEntries,
  isCaseSensitiveTerm,
  MAX_ENTRIES_PER_REQUEST,
  MAX_GLOSSARY_ROWS,
  MAX_TERM_LENGTH,
  normalizeRows,
  termKey,
} from '../../src/translate/glossary.ts'
import type { GlossaryEntry } from '../../src/translate/pfml3.ts'

/** 原文に出てくる語として選ばれた項目の、原文の語だけを返す。 */
function selected(entries: readonly GlossaryEntry[], source: string): string[] {
  return createGlossaryMatcher(entries)(source).map((entry) => entry.source)
}

const ATTENTION = { source: 'attention', target: '注意' }

describe('isCaseSensitiveTerm', () => {
  it('2 文字目以降に大文字がある語は、大文字と小文字を区別する', () => {
    for (const term of ['RNN', 'ReLU', 'CLIP', 'BLEU score', 't-SNE', 'GPT-4', 'ImageNet']) {
      expect(isCaseSensitiveTerm(term), term).toBe(true)
    }
  })

  it('小文字だけの語と、語頭だけが大文字の語は、区別しない', () => {
    for (const term of ['attention', 'Attention', 'Residual Connection', 'L-smooth', 'Q-learning', 'F1 score']) {
      expect(isCaseSensitiveTerm(term), term).toBe(false)
    }
  })
})

describe('termKey', () => {
  it('前後の空白、区切りの違い、大文字と小文字の違いを無視する', () => {
    expect(termKey('  Self-Attention ')).toBe('self attention')
    expect(termKey('self attention')).toBe('self attention')
    expect(termKey('self‐attention')).toBe('self attention')
    expect(termKey('learning   rate')).toBe('learning rate')
  })

  it('大文字と小文字を区別する語では、大文字と小文字をそのままにする', () => {
    expect(termKey('CLIP')).toBe('CLIP')
    expect(termKey('clip')).toBe('clip')
    expect(termKey('BLEU score')).toBe('BLEU score')
  })

  it('区切りの文字しか無い語は、空文字列になる', () => {
    expect(termKey(' - ')).toBe('')
  })
})

describe('checkRows', () => {
  it('語と訳語がそろった行を、前後の空白を取り除いて、翻訳に使う', () => {
    expect(checkRows([{ source: '  residual   connection ', target: ' スキップ接続 ' }])).toEqual({
      entries: [{ source: 'residual connection', target: 'スキップ接続' }],
      problems: [null],
    })
  })

  it('入力の途中の行は使わず、理由を返す', () => {
    const checked = checkRows([
      { source: '', target: '' },
      { source: ' ', target: '注意' },
      { source: 'attention', target: '  ' },
      { source: '-', target: 'ハイフン' },
    ])
    expect(checked.entries).toEqual([])
    expect(checked.problems).toEqual(['empty', 'no-source', 'no-target', 'no-source'])
  })

  it('上の行と同じ語の行は使わない。区切りと、大文字と小文字の違いは、同じ語とみなす', () => {
    const checked = checkRows([
      { source: 'self-attention', target: '自己注意' },
      { source: 'Self attention', target: 'セルフアテンション' },
      { source: 'attention', target: '注意' },
    ])
    expect(checked.entries.map((entry) => entry.target)).toEqual(['自己注意', '注意'])
    expect(checked.problems).toEqual([null, 'duplicate', null])
  })

  it('略語と、同じつづりの小文字の語は、別の語として扱う', () => {
    const checked = checkRows([
      { source: 'CLIP', target: 'CLIP' },
      { source: 'clip', target: '切り詰める' },
    ])
    expect(checked.problems).toEqual([null, null])
  })

  it('入力の途中の行は、あとの行の重複の判定に影響しない', () => {
    const checked = checkRows([
      { source: 'attention', target: '' },
      { source: 'attention', target: '注意' },
    ])
    expect(checked.problems).toEqual(['no-target', null])
    expect(checked.entries).toEqual([ATTENTION])
  })
})

describe('normalizeRows', () => {
  it('配列でない値からは、空の並びを返す', () => {
    expect(normalizeRows(null)).toEqual([])
    expect(normalizeRows('broken')).toEqual([])
    expect(normalizeRows({ source: 'a', target: 'b' })).toEqual([])
  })

  it('形の合わない要素は捨てる。入力の途中の行(空の文字列)は残す', () => {
    expect(
      normalizeRows([{ source: 'attention', target: '注意' }, null, 'text', { source: 'x' }, { source: 1, target: 'y' }, { source: '', target: '' }]),
    ).toEqual([ATTENTION, { source: '', target: '' }])
  })

  it('長すぎる文字列と、多すぎる行を切り詰める', () => {
    const long = 'a'.repeat(MAX_TERM_LENGTH + 10)
    expect(normalizeRows([{ source: long, target: long }])).toEqual([
      { source: 'a'.repeat(MAX_TERM_LENGTH), target: 'a'.repeat(MAX_TERM_LENGTH) },
    ])
    const many = Array.from({ length: MAX_GLOSSARY_ROWS + 5 }, (_, index) => ({ source: `term${index}`, target: '訳' }))
    expect(normalizeRows(many)).toHaveLength(MAX_GLOSSARY_ROWS)
  })
})

describe('describeEntries', () => {
  it('語と訳語を矢印でつなぎ、項目を読点で区切る', () => {
    expect(describeEntries([ATTENTION, { source: 'token', target: '字句' }])).toBe('attention → 注意、token → 字句')
    expect(describeEntries([])).toBe('')
  })
})

describe('createGlossaryMatcher', () => {
  it('原文に出てくる語の項目だけを返す', () => {
    const entries = [ATTENTION, { source: 'dropout', target: 'ドロップアウト' }]
    expect(createGlossaryMatcher(entries)('The model uses attention to weigh the tokens.')).toEqual([ATTENTION])
    expect(selected(entries, 'We report the mean over five runs.')).toEqual([])
  })

  it('用語集が空なら、何も返さない', () => {
    expect(selected([], 'The model uses attention.')).toEqual([])
  })

  it('文頭の大文字と、すべて大文字の見出しにも当てはまる', () => {
    expect(selected([ATTENTION], 'Attention is computed for every pair.')).toEqual(['attention'])
    expect(selected([{ source: 'related work', target: '先行研究' }], 'RELATED WORK')).toEqual(['related work'])
    expect(selected([{ source: 'Attention', target: '注意' }], 'We use attention here.')).toEqual(['Attention'])
  })

  it('略語のような語は、大文字と小文字が同じ場合にだけ当てはまる', () => {
    const clip = [{ source: 'CLIP', target: 'CLIP モデル' }]
    expect(selected(clip, 'We clip the gradients. Clipping is applied later.')).toEqual([])
    expect(selected(clip, 'We encode the image with CLIP.')).toEqual(['CLIP'])
    expect(selected([{ source: 'RNN', target: '再帰型ネットワーク' }], 'Two RNNs are stacked.')).toEqual(['RNN'])
  })

  it('複数形(s、es、ies)にも当てはまる', () => {
    expect(selected([{ source: 'residual connection', target: 'スキップ接続' }], 'All residual connections are kept.')).toEqual([
      'residual connection',
    ])
    expect(selected([{ source: 'loss', target: 'ロス' }], 'Both losses are averaged.')).toEqual(['loss'])
    expect(selected([{ source: 'query', target: '問い合わせ' }], 'The queries are dropped.')).toEqual(['query'])
    expect(selected([{ source: 'key', target: '鍵' }], 'All the keys are compared.')).toEqual(['key'])
    expect(selected([{ source: 'net', target: 'ネット' }], 'NETS AND COVERS')).toEqual(['net'])
  })

  it('別の語の一部には当てはまらない', () => {
    expect(selected([{ source: 'net', target: '網' }], 'The network has six layers.')).toEqual([])
    expect(selected([{ source: 'rate', target: '率' }], 'We generate and iterate.')).toEqual([])
    expect(selected([{ source: 'layer', target: '層' }], 'A multilayer model with 2layers.')).toEqual([])
  })

  it('動詞の活用形には当てはまらない', () => {
    expect(selected([{ source: 'fine-tune', target: '微調整' }], 'The fine-tuned model and fine-tuning.')).toEqual([])
    expect(selected([{ source: 'fine-tune', target: '微調整' }], 'We fine-tune the model.')).toEqual(['fine-tune'])
  })

  it('語と語の間の空白とハイフンを区別しない', () => {
    expect(selected([{ source: 'self attention', target: '自己注意' }], 'We use self-attention in every layer.')).toEqual([
      'self attention',
    ])
    expect(selected([{ source: 'learning-rate', target: '学習係数' }], 'The learning rate grows.')).toEqual(['learning-rate'])
    expect(selected([{ source: 'encoder-decoder', target: '符号化器と復号器' }], 'An encoder–decoder model.')).toEqual([
      'encoder-decoder',
    ])
    // 区切りが無い形には、当てはまらない。
    expect(selected([{ source: 'self attention', target: '自己注意' }], 'We use selfattention.')).toEqual([])
  })

  it('ハイフンでつないだ複合語の中の語にも当てはまる', () => {
    expect(selected([ATTENTION], 'The decoder uses encoder-decoder attention.')).toEqual(['attention'])
    expect(selected([ATTENTION], 'Multi-head attention runs in parallel.')).toEqual(['attention'])
  })

  it('長い語の一部としてしか出てこない短い語は、選ばない', () => {
    const entries = [
      { source: 'attention', target: '注意機構' },
      { source: 'self-attention', target: '自己注意' },
    ]
    expect(selected(entries, 'We use self-attention in every layer. Self-attention is cheap.')).toEqual(['self-attention'])
    // 短い語が単独でも出てくる場合は、両方を選ぶ。
    expect(selected(entries, 'Self-attention relates positions. In the decoder, attention is also applied.')).toEqual([
      'self-attention',
      'attention',
    ])
  })

  it('一部だけが重なる語は、両方を選ぶ', () => {
    const entries = [
      { source: 'neural network', target: 'ニューラルネット' },
      { source: 'network architecture', target: '網の構造' },
    ]
    expect(selected(entries, 'The neural network architecture is simple.')).toEqual(['neural network', 'network architecture'])
  })

  it('同じつづりの略語と小文字の語は、原文の大文字と小文字に合うほうを選ぶ', () => {
    const entries = [
      { source: 'map', target: '写像' },
      { source: 'MAP', target: '最大事後確率' },
    ]
    expect(selected(entries, 'We compute the MAP estimate.')).toEqual(['MAP'])
    expect(selected(entries, 'The map is linear.')).toEqual(['map'])
    expect(selected(entries, 'The map gives the MAP estimate.')).toEqual(['map', 'MAP'])
  })

  it('原文に出てくる順に返す。同じ位置なら、登録した順に返す', () => {
    const entries = [
      { source: 'dropout', target: 'ドロップアウト' },
      { source: 'learning rate', target: '学習係数' },
      { source: 'weight decay', target: '荷重減衰' },
    ]
    expect(selected(entries, 'Weight decay is not used. We set the learning rate and apply dropout.')).toEqual([
      'weight decay',
      'learning rate',
      'dropout',
    ])
  })

  it('数式の目印は、語の一部にも、語と語の間の区切りにもならない', () => {
    expect(selected([{ source: 'm1', target: '目印' }], 'The value <m1> is small.')).toEqual([])
    expect(selected([{ source: 'learning rate', target: '学習係数' }], 'The learning <m1> rate.')).toEqual([])
    expect(selected([{ source: 'step size', target: '刻み幅' }], 'The step size <m1> is chosen so that <m2> holds.')).toEqual(['step size'])
    expect(selected([{ source: 'smooth', target: '平滑' }], 'If <m1> is <m2>-smooth, then it converges.')).toEqual(['smooth'])
  })

  it('記号を含む語を、正規表現の記号として扱わない', () => {
    expect(selected([{ source: 'C++', target: 'C++ 言語' }], 'The code is written in C++ and Python.')).toEqual(['C++'])
    expect(selected([{ source: 'a.b', target: '訳' }], 'The value axb is not a match.')).toEqual([])
    expect(selected([{ source: 'TCP/IP', target: 'TCP/IP' }], 'It runs over TCP/IP.')).toEqual(['TCP/IP'])
  })

  it('1 件の依頼に付ける項目の数に、上限がある。超える場合は、原文に先に出てくるものを残す', () => {
    const count = MAX_ENTRIES_PER_REQUEST + 5
    const entries = Array.from({ length: count }, (_, index) => ({ source: `term${index}x`, target: `訳${index}` }))
    // 登録した順とは逆の順に、原文に並べる。
    const source = [...entries].reverse().map((entry) => entry.source).join(' and ')
    const result = selected(entries, source)
    expect(result).toHaveLength(MAX_ENTRIES_PER_REQUEST)
    expect(result[0]).toBe(`term${count - 1}x`)
    expect(result.at(-1)).toBe(`term${count - MAX_ENTRIES_PER_REQUEST}x`)
  })

  it('同じ関数を、複数の原文に続けて使える', () => {
    const select = createGlossaryMatcher([ATTENTION])
    expect(select('attention and attention')).toEqual([ATTENTION])
    expect(select('no match here')).toEqual([])
    expect(select('Attention again')).toEqual([ATTENTION])
  })
})
