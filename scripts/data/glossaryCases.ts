/**
 * 用語集の効き方を確かめる実験で訳させる、英語の文章と、それに付ける用語集。
 *
 * - すべて、この実験のために書き起こした文章である。論文からの転載は含まない。
 * - 訳語は、用語集が無いときに選ばれやすい訳語とは、わざと別のものにしてある。用語集が効いたかどうかを、訳文から見分けるためである。
 *   そのため、訳語として自然でないものを含む。
 * - 文中の数式は、アプリ本体と同じ目印(<m1> など)で書いてある。
 */

import type { GlossaryEntry } from '../../src/translate/pfml3.ts'

/**
 * 語の出方の種類。
 * - basic: 原文に、登録した形のまま出てくる
 * - case: 大文字と小文字が、登録した形と違う
 * - inflected: 複数形や活用形で出てくる
 * - compound: 複合語の一部として出てくる。または、ハイフンと空白の表記が違う
 * - acronym: 略語
 * - keep: 訳さずに、英語のまま残す
 * - math: 数式の目印と一緒に出てくる
 * - overlap: 長い語と、その一部である短い語の両方を登録してある
 * - long: 長い段落に、何度も出てくる
 * - absent: 登録した語が、原文に出てこない
 */
export const GLOSSARY_CASE_KINDS = [
  'basic',
  'case',
  'inflected',
  'compound',
  'acronym',
  'keep',
  'math',
  'overlap',
  'long',
  'absent',
] as const
export type GlossaryCaseKind = (typeof GLOSSARY_CASE_KINDS)[number]

export interface GlossaryCase {
  kind: GlossaryCaseKind
  /** 訳させる英語の文章。 */
  text: string
  /** 依頼に付ける用語集。 */
  glossary: readonly GlossaryEntry[]
  /** 用語集を付けた訳文に、含まれているはずの文字列(指定した訳語)。 */
  expect: readonly string[]
  /** 用語集を付けた訳文に、含まれていてはいけない文字列(用語集が無いときに選ばれやすい訳語など)。 */
  avoid: readonly string[]
  /** この件で見たいこと。 */
  focus: string
}

const ATTENTION_PARAGRAPH =
  'Attention lets a model decide which parts of the input matter for each output. ' +
  'In the encoder, attention is applied to all positions at once, so every token can see every other token. ' +
  'The cost of attention grows with the square of the sequence length, which becomes a problem for long documents. ' +
  'Several papers reduce this cost by restricting attention to a local window. ' +
  'We take a different route: we keep full attention in the lower layers and replace it with a cheaper operation in the upper layers. ' +
  'Our experiments show that the upper layers rarely need attention over distant tokens.'

const SCHEDULE_PARAGRAPH =
  'We train all models with the same schedule. ' +
  'The learning rate starts at zero and grows linearly during the first four thousand steps. ' +
  'After that, the learning rate decays in proportion to the inverse square root of the step number. ' +
  'The batch size is chosen so that each batch holds about twenty-five thousand tokens. ' +
  'A larger batch size did not improve the results, although it made each step slower. ' +
  'We apply weight decay to all matrices but not to the biases. ' +
  'Without weight decay, the largest model reached a lower training loss and a higher test loss. ' +
  'All runs use the same learning rate schedule, and we did not tune it for individual tasks.'

/** 原文に出てこない語として渡す、20 件の用語集。 */
const UNRELATED_TERMS: readonly GlossaryEntry[] = [
  { source: 'gradient descent', target: '最急降下法' },
  { source: 'learning rate', target: '学習係数' },
  { source: 'batch size', target: 'ミニバッチの大きさ' },
  { source: 'dropout', target: 'ドロップアウト正則化' },
  { source: 'weight decay', target: '荷重減衰' },
  { source: 'optimizer', target: '最適化器' },
  { source: 'epoch', target: '周回' },
  { source: 'loss function', target: 'ロス関数' },
  { source: 'activation function', target: '発火関数' },
  { source: 'convolution', target: 'たたみ込み演算' },
  { source: 'pooling', target: '集約演算' },
  { source: 'embedding', target: '分散表現' },
  { source: 'tokenizer', target: '字句分割器' },
  { source: 'beam search', target: 'ビーム探索法' },
  { source: 'fine-tuning', target: '微調整' },
  { source: 'pre-training', target: '事前訓練' },
  { source: 'overfitting', target: '過剰適合' },
  { source: 'regularization', target: '正則化項' },
  { source: 'backpropagation', target: '逆伝播法' },
  { source: 'hyperparameter', target: '超パラメータ' },
]

export const GLOSSARY_CASES: readonly GlossaryCase[] = [
  // 原文に、登録した形のまま出てくる語。
  {
    kind: 'basic',
    text: 'The model uses attention to weigh the tokens. Without attention, the encoder treats every token equally.',
    glossary: [{ source: 'attention', target: '注意' }],
    expect: ['注意'],
    avoid: ['アテンション'],
    focus: 'カタカナで訳されやすい語を、漢語に固定する',
  },
  {
    kind: 'basic',
    text: 'We add a residual connection around each layer. The residual connection keeps the gradient from vanishing.',
    glossary: [{ source: 'residual connection', target: 'スキップ接続' }],
    expect: ['スキップ接続'],
    avoid: ['残差接続'],
    focus: '2 語の用語を、別の訳語に固定する',
  },
  {
    kind: 'basic',
    text: 'We set the learning rate to a small value at the start. The learning rate is then raised over the first thousand steps.',
    glossary: [{ source: 'learning rate', target: '学習係数' }],
    expect: ['学習係数'],
    avoid: ['学習率'],
    focus: '定まった訳語がある語を、別の訳語に固定する',
  },
  {
    kind: 'basic',
    text: 'A transformer maps a sequence of tokens to a sequence of vectors. Each token attends to all the other tokens.',
    glossary: [
      { source: 'transformer', target: '変換器' },
      { source: 'token', target: '字句' },
    ],
    expect: ['変換器', '字句'],
    avoid: ['トランスフォーマー', 'Transformer', 'トークン'],
    focus: '2 つの語を同時に固定する',
  },
  {
    kind: 'basic',
    text: 'The model starts overfitting after ten epochs. To delay overfitting, we stop the training early.',
    glossary: [{ source: 'overfitting', target: '過剰適合' }],
    expect: ['過剰適合'],
    avoid: ['過学習'],
    focus: '定まった訳語がある語を、別の訳語に固定する',
  },
  {
    kind: 'basic',
    text: 'We run an ablation study to see which component matters. The ablation study removes one component at a time.',
    glossary: [{ source: 'ablation study', target: '切除実験' }],
    expect: ['切除実験'],
    avoid: ['アブレーション'],
    focus: 'カタカナで訳されやすい語を、漢語に固定する',
  },
  {
    kind: 'basic',
    text: 'Our method is compared with a strong baseline. The baseline uses the same data but a smaller model.',
    glossary: [{ source: 'baseline', target: '基準手法' }],
    expect: ['基準手法'],
    avoid: ['ベースライン'],
    focus: 'カタカナで訳されやすい語を、漢語に固定する',
  },
  {
    kind: 'basic',
    text: 'The loss is averaged over the batch. When the loss stops decreasing, we halve the step size.',
    glossary: [
      { source: 'loss', target: 'ロス' },
      { source: 'step size', target: '刻み幅' },
    ],
    expect: ['ロス', '刻み幅'],
    avoid: ['損失', 'ステップサイズ'],
    focus: '漢語で訳されやすい語を、カタカナに固定する',
  },

  // 大文字と小文字が、登録した形と違う語。
  {
    kind: 'case',
    text: 'Attention is computed for every pair of tokens. This makes attention expensive for long inputs.',
    glossary: [{ source: 'attention', target: '注意' }],
    expect: ['注意'],
    avoid: ['アテンション'],
    focus: '文頭で大文字になった語(用語集は小文字)',
  },
  {
    kind: 'case',
    text: 'The model uses attention to weigh the tokens. Without attention, the encoder treats every token equally.',
    glossary: [{ source: 'Attention', target: '注意' }],
    expect: ['注意'],
    avoid: ['アテンション'],
    focus: '用語集のほうが、大文字で始まる場合',
  },
  {
    kind: 'case',
    text: 'Residual Connections and Normalization',
    glossary: [{ source: 'residual connection', target: 'スキップ接続' }],
    expect: ['スキップ接続'],
    avoid: ['残差接続'],
    focus: '見出しで、語頭が大文字になった語(複数形)',
  },
  {
    kind: 'case',
    text: 'RELATED WORK',
    glossary: [{ source: 'related work', target: '先行研究' }],
    expect: ['先行研究'],
    avoid: ['関連研究'],
    focus: 'すべて大文字で書かれた見出し',
  },

  // 複数形や活用形で出てくる語。
  {
    kind: 'inflected',
    text: 'Deep networks are hard to train. Residual connections make the optimization easier, and all residual connections are followed by normalization.',
    glossary: [{ source: 'residual connection', target: 'スキップ接続' }],
    expect: ['スキップ接続'],
    avoid: ['残差接続'],
    focus: '複数形(用語集は単数形)',
  },
  {
    kind: 'inflected',
    text: 'A net is a finite set of points such that every point of the space lies close to one of them. Nets let us replace an infinite family by a finite one.',
    glossary: [{ source: 'net', target: 'ネット' }],
    expect: ['ネット'],
    avoid: ['網'],
    focus: '多義の語の、単数形と複数形',
  },
  {
    kind: 'inflected',
    text: 'We fine-tune the model on each task. The fine-tuned model is then evaluated, and fine-tuning takes about two hours.',
    glossary: [{ source: 'fine-tune', target: '微調整' }],
    expect: ['微調整'],
    avoid: ['ファインチューニング'],
    focus: '動詞の活用形(-ed、-ing)',
  },
  {
    kind: 'inflected',
    text: 'Each query is compared with all the keys. The queries that match no key are dropped.',
    glossary: [{ source: 'query', target: '問い合わせ' }],
    expect: ['問い合わせ'],
    avoid: ['クエリ'],
    focus: '複数形で語尾が変わる語(query と queries)',
  },
  {
    kind: 'inflected',
    text: 'The embeddings are shared between the encoder and the decoder. We scale the embeddings before adding the positions.',
    glossary: [{ source: 'embedding', target: '分散表現' }],
    expect: ['分散表現'],
    avoid: ['埋め込み'],
    focus: '原文には複数形しか出てこない語',
  },

  // 複合語の一部として出てくる語と、ハイフンと空白の表記が違う語。
  {
    kind: 'compound',
    text: 'The decoder uses encoder-decoder attention to read the source sentence.',
    glossary: [{ source: 'attention', target: '注意機構' }],
    expect: ['注意機構'],
    avoid: ['アテンション'],
    focus: 'ハイフンでつないだ複合語のあとに続く語',
  },
  {
    kind: 'compound',
    text: 'Self-attention relates different positions of one sequence. Unlike self-attention, encoder-decoder attention looks at the output of the encoder.',
    glossary: [{ source: 'attention', target: '注意機構' }],
    expect: ['注意機構'],
    avoid: ['アテンション'],
    focus: '複合語の一部として、何度も出てくる語',
  },
  {
    kind: 'compound',
    text: 'Multi-head attention runs several attention functions in parallel.',
    glossary: [{ source: 'attention', target: '注意' }],
    expect: ['注意'],
    avoid: ['アテンション'],
    focus: '複合語の一部として出てくる語',
  },
  {
    kind: 'compound',
    text: 'The learning-rate schedule has two phases. In the first phase the learning rate grows linearly.',
    glossary: [{ source: 'learning rate', target: '学習係数' }],
    expect: ['学習係数'],
    avoid: ['学習率'],
    focus: '原文ではハイフンでつながり、用語集では空白で区切られている語',
  },
  {
    kind: 'compound',
    text: 'Self-attention relates different positions of one sequence. We use self-attention in every layer.',
    glossary: [{ source: 'self attention', target: '自己注意' }],
    expect: ['自己注意'],
    avoid: ['セルフアテンション'],
    focus: '原文ではハイフンでつながり、用語集では空白で区切られている語',
  },

  // 略語。
  {
    kind: 'acronym',
    text: 'An RNN reads the sentence one word at a time. Our RNN has two layers.',
    glossary: [{ source: 'RNN', target: '再帰型ニューラルネットワーク' }],
    expect: ['再帰型ニューラルネットワーク'],
    avoid: ['RNN'],
    focus: '略語を、日本語の名前に置き換える',
  },
  {
    kind: 'acronym',
    text: 'We train the model with SGD. Compared with adaptive methods, SGD needs a carefully tuned step size.',
    glossary: [{ source: 'SGD', target: '確率的勾配降下法' }],
    expect: ['確率的勾配降下法'],
    avoid: ['SGD'],
    focus: '略語を、日本語の名前に置き換える',
  },
  {
    kind: 'acronym',
    text: 'The LSTM keeps a cell state. Each LSTM layer has four gates in our variant.',
    glossary: [{ source: 'LSTM', target: '長・短期記憶' }],
    expect: ['長・短期記憶'],
    avoid: ['LSTM'],
    focus: '略語を、日本語の名前に置き換える',
  },
  {
    kind: 'acronym',
    text: 'Our system reaches a BLEU of 27.3 on the test set, which is 1.2 BLEU higher than the previous best.',
    glossary: [{ source: 'BLEU', target: 'BLEU 値' }],
    expect: ['BLEU 値'],
    avoid: ['BLEUスコア', 'BLEU スコア'],
    focus: '略語に、語を足した訳語にする',
  },

  // 訳さずに、英語のまま残す語。
  {
    kind: 'keep',
    text: 'Each attention head reads a set of tokens. We prune the attention heads one at a time.',
    glossary: [{ source: 'attention head', target: 'attention head' }],
    expect: ['attention head'],
    avoid: ['アテンションヘッド', '注意ヘッド'],
    focus: '2 語の用語を、英語のまま残す',
  },
  {
    kind: 'keep',
    text: 'We apply dropout to the output of each sublayer. The dropout rate is the same in all layers.',
    glossary: [{ source: 'dropout', target: 'dropout' }],
    expect: ['dropout'],
    avoid: ['ドロップアウト'],
    focus: '1 語の用語を、英語のまま残す',
  },
  {
    kind: 'keep',
    text: 'The warm-up lasts four thousand steps. After the warm-up, the step size decays.',
    glossary: [{ source: 'warm-up', target: 'warm-up' }],
    expect: ['warm-up'],
    avoid: ['ウォームアップ'],
    focus: 'ハイフンを含む用語を、英語のまま残す',
  },

  // 数式の目印と一緒に出てくる語。
  {
    kind: 'math',
    text: 'The learning rate <m1> is decayed by a factor of <m2> every <m3> epochs, and the batch size is fixed to <m4>.',
    glossary: [
      { source: 'learning rate', target: '学習係数' },
      { source: 'batch size', target: 'ミニバッチの大きさ' },
    ],
    expect: ['学習係数', 'ミニバッチの大きさ'],
    avoid: ['学習率', 'バッチサイズ'],
    focus: '数式の目印が 4 つある文',
  },
  {
    kind: 'math',
    text: 'For every token <m1>, the attention weight <m2> is non-negative, and the attention weights sum to <m3>.',
    glossary: [{ source: 'attention weight', target: '注意の重み' }],
    expect: ['注意の重み'],
    avoid: ['アテンション'],
    focus: '語の直後に、数式の目印がある文',
  },
  {
    kind: 'math',
    text: 'The step size <m1> is chosen so that <m2> holds, where <m3> is the smoothness constant of the objective.',
    glossary: [
      { source: 'step size', target: '刻み幅' },
      { source: 'smoothness constant', target: '平滑性の定数' },
    ],
    expect: ['刻み幅', '平滑性の定数'],
    avoid: ['ステップサイズ'],
    focus: '数式の目印が 3 つある文',
  },
  {
    kind: 'math',
    text: 'If <m1> is <m2>-smooth, then gradient descent with step size <m3> converges at the rate <m4>.',
    glossary: [
      { source: 'gradient descent', target: '最急降下法' },
      { source: 'step size', target: '刻み幅' },
    ],
    expect: ['最急降下法', '刻み幅'],
    avoid: ['勾配降下法', 'ステップサイズ'],
    focus: '数式の目印と語が、ハイフンでつながっている文',
  },

  // 長い語と、その一部である短い語の両方を登録してある場合。
  {
    kind: 'overlap',
    text: 'Self-attention relates different positions of one sequence. In the decoder, attention is also applied to the output of the encoder.',
    glossary: [
      { source: 'attention', target: '注意機構' },
      { source: 'self-attention', target: '自己注意' },
    ],
    expect: ['自己注意', '注意機構'],
    avoid: ['アテンション'],
    focus: '長い語と短い語の両方が、原文に出てくる',
  },
  {
    kind: 'overlap',
    text: 'Self-attention relates different positions of one sequence. We use self-attention in every layer.',
    glossary: [
      { source: 'attention', target: '注意機構' },
      { source: 'self-attention', target: '自己注意' },
    ],
    expect: ['自己注意'],
    avoid: ['アテンション', '注意機構'],
    focus: '短い語が、長い語の一部としてしか原文に出てこない',
  },
  {
    kind: 'overlap',
    text: 'A neural network has many parameters. The network is trained end to end.',
    glossary: [
      { source: 'network', target: '回路網' },
      { source: 'neural network', target: 'ニューラルネット' },
    ],
    expect: ['ニューラルネット', '回路網'],
    avoid: ['ニューラルネットワーク'],
    focus: '長い語と短い語の両方が、原文に出てくる',
  },
  {
    kind: 'overlap',
    text: 'A neural network has many parameters. Training a neural network end to end takes several days.',
    glossary: [
      { source: 'network', target: '回路網' },
      { source: 'neural network', target: 'ニューラルネット' },
    ],
    expect: ['ニューラルネット'],
    avoid: ['ニューラルネットワーク', '回路網'],
    focus: '短い語が、長い語の一部としてしか原文に出てこない',
  },
  {
    kind: 'overlap',
    text: 'A language model assigns a probability to every sentence. We train the language model on a large corpus.',
    glossary: [
      { source: 'model', target: '模型' },
      { source: 'language model', target: '言語モデル' },
    ],
    expect: ['言語モデル'],
    avoid: ['模型'],
    focus: '短い語が、長い語の一部としてしか原文に出てこない',
  },

  // 長い段落に、何度も出てくる語。
  {
    kind: 'long',
    text: ATTENTION_PARAGRAPH,
    glossary: [{ source: 'attention', target: '注意' }],
    expect: ['注意'],
    avoid: ['アテンション'],
    focus: '同じ語が 6 回出てくる段落',
  },
  {
    kind: 'long',
    text: SCHEDULE_PARAGRAPH,
    glossary: [
      { source: 'learning rate', target: '学習係数' },
      { source: 'batch size', target: 'ミニバッチの大きさ' },
      { source: 'weight decay', target: '荷重減衰' },
    ],
    expect: ['学習係数', 'ミニバッチの大きさ', '荷重減衰'],
    avoid: ['学習率', 'バッチサイズ', '重み減衰'],
    focus: '3 つの語が、合わせて 7 回出てくる段落',
  },

  // 登録した語が、原文に出てこない場合。expect は空で、avoid に、混ざってはいけない訳語を書く。
  {
    kind: 'absent',
    text: 'The model uses attention to weigh the tokens. Without attention, the encoder treats every token equally.',
    glossary: [
      { source: 'dropout', target: 'ドロップアウト正則化' },
      { source: 'batch size', target: 'ミニバッチの大きさ' },
      { source: 'learning rate', target: '学習係数' },
    ],
    expect: [],
    avoid: ['ドロップアウト正則化', 'ミニバッチの大きさ', '学習係数'],
    focus: '原文に出てこない語を 3 件渡す',
  },
  {
    kind: 'absent',
    text: 'We report the mean and the standard deviation over five runs. The differences between runs are small.',
    glossary: UNRELATED_TERMS,
    expect: [],
    avoid: UNRELATED_TERMS.map((entry) => entry.target),
    focus: '原文に出てこない語を 20 件渡す',
  },
  {
    kind: 'absent',
    text: 'The network has six layers. Each layer of the network contains two sublayers.',
    glossary: [{ source: 'net', target: '網' }],
    expect: [],
    avoid: ['網'],
    focus: '登録した語が、原文の語の一部としてしか出てこない(net と network)',
  },
  {
    kind: 'absent',
    text: 'We clip the gradients so that their norm never exceeds one. Clipping is applied after the gradients are averaged.',
    glossary: [{ source: 'CLIP', target: 'CLIP モデル' }],
    expect: [],
    avoid: ['CLIP'],
    focus: '登録した略語と、大文字と小文字だけが違う語が出てくる(CLIP と clip)',
  },
]
