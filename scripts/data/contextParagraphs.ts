/**
 * 文脈の渡し方を比べる実験で訳させる、短い論文の形をした英語の文章。
 *
 * - すべて、この実験のために書き起こした文章である。論文からの転載は含まない。
 * - 前の段落を読まないと意味が決まらない箇所(代名詞、"the former"、多義の語、文の途中から始まる段落)を、わざと入れてある。
 * - 文中の数式は、アプリ本体と同じ目印(<m1> など)で書いてある。
 */

export interface ContextParagraph {
  /** 見出しか、本文か。 */
  kind: 'heading' | 'body'
  text: string
  /** この段落で見たいこと。 */
  focus: string
}

export const CONTEXT_TITLE = 'Sparse Attention Heads and the Nets That Cover Them'

export const CONTEXT_PARAGRAPHS: readonly ContextParagraph[] = [
  { kind: 'heading', text: '1 Introduction', focus: '見出しの訳' },
  {
    kind: 'body',
    text: 'Attention heads are the basic unit of a transformer layer. Each head reads a set of tokens and writes a weighted sum of their values. In this paper we ask how many heads a layer really needs.',
    focus: '"head" の訳語(以後の段落とそろうか)',
  },
  {
    kind: 'body',
    text: 'They are cheap to compute but hard to interpret. Pruning them one at a time is the usual way to find out which ones matter.',
    focus: '代名詞 "They" が、前の段落の head を指すこと',
  },
  { kind: 'heading', text: '2 Nets', focus: '多義の見出し("網" か "ネット" か)' },
  {
    kind: 'body',
    text: 'A net is a finite set of points such that every point of the space lies close to one of them. We use two quantities: the covering number <m1> and the metric entropy <m2>. Nets let us replace an infinite family of heads by a finite one.',
    focus: '"net" の訳語と、数式の目印',
  },
  {
    kind: 'body',
    text: 'The former is easy to bound, while the latter requires a chaining argument. We give both bounds in the appendix.',
    focus: '"The former" と "the latter" が、前の段落の 2 つの量を指すこと',
  },
  { kind: 'heading', text: '3 Training', focus: '見出しの訳' },
  {
    kind: 'body',
    text: 'We train on a single machine. The schedule follows the base model, except that the warm-up is twice as long. The logits are scaled as follows:',
    focus: 'コロンで終わり、独立した数式へ続く段落',
  },
  {
    kind: 'body',
    text: 'where <m1> is the temperature and <m2> is the number of heads.',
    focus: '独立した数式のあと、文の途中から始まる段落',
  },
  {
    kind: 'body',
    text: 'Each head keeps its own net, and the nets are refreshed every <m1> steps.',
    focus: '"head" と "net" の訳語が、前の節とそろうか',
  },
]
