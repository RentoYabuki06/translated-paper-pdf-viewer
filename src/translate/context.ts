/**
 * 翻訳の依頼に付ける、文脈の文字列を作る。
 *
 * 段落は 1 つずつ独立に訳すが、分野や話の流れが分からないと、訳語を誤ることがある。
 * そこで、論文の題名、節の見出し、直前の段落の原文を、翻訳のモデルの「文脈」の欄に渡す。
 * 文脈は参考情報で、訳されない。文脈の欄を選んだ理由は、note/016_probe-context.md に書いている。
 */

import type { TranslationUnit } from '../analysis/units.ts'

export interface ContextParts {
  /** 論文の題名。 */
  title: string
  /** 段落が属する節の見出し。 */
  section: string
  /** 直前の本文の段落。 */
  previous: string
  /** 直後の本文。文の途中で終わる段落でだけ使う。 */
  following: string
}

/** 文脈に入れる文字数の上限。 */
const TITLE_LIMIT = 300
const SECTION_LIMIT = 200
/** 直前の段落は、終わりのほうが今回の段落に近いので、後ろからこの文字数までを使う。 */
const PREVIOUS_LIMIT = 400
const FOLLOWING_LIMIT = 200

/** 文の終わりの記号で終わっているかどうか。コロンで終わる段落は、文が続くとみなす。 */
const SENTENCE_END = /[.!?。]["'”’)\]]*\s*$/

/** 文脈に入れる文字列を整える。数式の目印は、文脈の中では意味を持たないので、「…」に置き換える。 */
function clean(text: string): string {
  return text
    .replace(/<m\d+>/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 前から limit 文字までを、単語の切れ目で切り取る。 */
function head(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()} …`
}

/** 後ろから limit 文字までを、単語の切れ目で切り取る。 */
function tail(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(-limit)
  const space = cut.indexOf(' ')
  return `… ${(space >= 0 ? cut.slice(space + 1) : cut).trimStart()}`
}

/** 文脈の文字列を作る。渡すものが何も無ければ、undefined を返す。 */
export function formatContext(parts: ContextParts): string | undefined {
  const lines = [
    parts.title && `Title: ${head(clean(parts.title), TITLE_LIMIT)}`,
    parts.section && `Section: ${head(clean(parts.section), SECTION_LIMIT)}`,
    parts.previous && `Previous paragraph: ${tail(clean(parts.previous), PREVIOUS_LIMIT)}`,
    parts.following && `Following text: ${head(clean(parts.following), FOLLOWING_LIMIT)}`,
  ].filter((line) => line)
  return lines.length > 0 ? lines.join('\n') : undefined
}

export interface ContextSource {
  /** 論文の題名。分からなければ空文字列。 */
  title: string
  /** 前のページの翻訳単位(つなぐ前、読む順)。ページが無ければ null。 */
  previousPage: readonly TranslationUnit[] | null
  /** このページの翻訳単位(つなぐ前、読む順)。 */
  page: readonly TranslationUnit[]
  /** このページから始まる、確定した翻訳単位(段やページをまたぐ段落をつないだもの)。 */
  units: readonly TranslationUnit[]
}

/**
 * 1 ページ分の翻訳単位について、文脈の文字列を作る。返すのは、翻訳単位の名前(id)から文脈への対応。
 *
 * - 本文(text): 題名、節の見出し、直前の本文の段落。文の途中で終わる段落には、直後の本文も足す。
 * - 節の見出し(paragraph_title): 題名と、その節の最初の本文。見出しは短く、それだけでは意味が決まらないことがある。
 * - 題名(doc_title): 文脈を付けない。
 * - それ以外(要旨、図表の説明文、脚注): 題名だけ。
 *
 * 節の見出しと直前の段落は、このページと前のページの範囲で探す。
 * 2 ページより前にさかのぼらない理由は、どのページから翻訳を始めても、同じ文脈になるようにするためである。
 */
export function buildContexts(source: ContextSource): Map<string, string> {
  // 読む順にたどりながら、各段落の時点での、節の見出しと直前の本文を覚える。
  const before = new Map<string, { section: string; previous: string }>()
  let section = ''
  let previous = ''
  for (const unit of [...(source.previousPage ?? []), ...source.page]) {
    before.set(unit.id, { section, previous })
    if (unit.kind === 'paragraph_title') {
      section = unit.source
      previous = ''
    } else if (unit.kind === 'text' || unit.kind === 'abstract') {
      previous = unit.source
    }
  }

  const contexts = new Map<string, string>()
  for (const unit of source.units) {
    if (unit.kind === 'doc_title') continue
    const parts: ContextParts = { title: source.title, section: '', previous: '', following: '' }
    if (unit.kind === 'text') {
      const state = before.get(unit.id)
      parts.section = state?.section ?? ''
      parts.previous = state?.previous ?? ''
      parts.following = followingText(unit, source.page)
    } else if (unit.kind === 'paragraph_title') {
      parts.following = firstBodyAfter(unit, source.page)
    }
    const context = formatContext(parts)
    if (context !== undefined) contexts.set(unit.id, context)
  }
  return contexts
}

/**
 * 節の見出しの次に来る本文(その節の最初の段落)を返す。次が別の見出しの場合や、本文が無い場合は、空文字列。
 * 読む順で、このページの中だけを探す。
 */
function firstBodyAfter(heading: TranslationUnit, page: readonly TranslationUnit[]): string {
  const index = page.findIndex((unit) => unit.id === heading.id)
  if (index === -1) return ''
  for (const unit of page.slice(index + 1)) {
    if (unit.kind === 'text') return unit.source
    if (unit.kind === 'paragraph_title') return ''
  }
  return ''
}

/**
 * 文の途中で終わる段落の、直後の本文を返す。無ければ空文字列。
 *
 * 独立した数式をはさんで文が続く場合("… is defined as" のあとに数式があり、"where …" と続く場合)に当たる。
 * 対象は、同じ段の真下にある本文に限る。段やページをまたぐ続きは、翻訳単位としてつないであるので、ここでは扱わない。
 */
function followingText(unit: TranslationUnit, page: readonly TranslationUnit[]): string {
  if (unit.fragments.length !== 1 || SENTENCE_END.test(unit.source)) return ''
  const rect = unit.fragments[0]?.rect
  if (!rect) return ''
  let best: TranslationUnit | undefined
  for (const other of page) {
    const otherRect = other.fragments[0]?.rect
    if (other.id === unit.id || other.kind !== 'text' || !otherRect) continue
    const below = otherRect.y >= rect.y + rect.height - 1
    const overlap = Math.min(rect.x + rect.width, otherRect.x + otherRect.width) - Math.max(rect.x, otherRect.x)
    if (!below || overlap <= 0) continue
    if (!best || otherRect.y < (best.fragments[0]?.rect.y ?? Infinity)) best = other
  }
  return best?.source ?? ''
}
