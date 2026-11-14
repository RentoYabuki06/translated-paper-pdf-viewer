/**
 * PLaMo 3 Translate の入力書式「PFML3」を組み立てる。
 *
 * 書式の出典は PFN のモデルカード(pfnet/plamo-3-translate-8b-GGUF の README、"PFML3 Prompt Format" の節)。
 * 要素の並びは次のとおり。
 *
 *   dataset → context(任意)→ 履歴の input/output の組(任意)→ glossary(任意)→ input → output
 *
 * 文頭の <|plamo:bos|> は llama.cpp が自動で付けるため、ここでは付けない。
 */

const TAG = '<|plamo:tag|>'
const MSG = '<|plamo:msg|>'
const KEY = '<|plamo:key|>'
const VAL = '<|plamo:val|>'
const INDEX = '<|plamo:index|>'
const ITEM = '<|plamo:item|>'

/** 訳文の生成が終わった直後にモデルが出す特殊トークン。出力の末尾に残っていたら取り除く。 */
export const PFML3_END_MARKERS = ['<|plamo:tag|>', '<|plamo:bos|>', '<|plamo:eos|>'] as const

/** 日本語の文体。plain はだ・である調、polite はです・ます調。 */
export type JapaneseForm = 'plain' | 'polite'

/** 用語集の 1 項目。原文中の語と、その訳語。 */
export interface GlossaryEntry {
  source: string
  target: string
}

/** 履歴の 1 組。すでに訳し終えた原文と訳文。 */
export interface HistoryPair {
  source: string
  translation: string
}

export interface Pfml3Request {
  /** 今回訳す原文。 */
  source: string
  /** 訳先の言語コード(例: "ja")。必須。 */
  targetLang: string
  /** 原文の言語コード(例: "en")。省略するとモデルが原文から判定する。 */
  sourceLang?: string
  /** 原文を解釈するための参考情報(前後の文章や場面の説明)。 */
  context?: string
  /** 訳語を固定したい用語の一覧。今回の原文だけに適用される。 */
  glossary?: readonly GlossaryEntry[]
  /** 直前までの原文と訳文の組。文書の順に並べる。 */
  history?: readonly HistoryPair[]
  /** 日本語の文体。targetLang が "ja" のときだけ指定できる。 */
  form?: JapaneseForm
}

/**
 * 本文中の文字列が PFML3 の区切りとして解釈されないようにする。
 *
 * PDF から取り出した文章は信頼できない入力である。
 * 文章の中に "<|plamo:tag|>" のような文字列があると、依頼の構造を書き換えられてしまう。
 * "<" と "|" の間にゼロ幅スペースを挟み、特殊トークンとして読まれないようにする。
 */
export function neutralizeSpecialTokens(text: string): string {
  return text.replace(/<\|(?=plamo:)/g, '<​|')
}

function attribute(name: string, value: string): string {
  return `${KEY}${name}${VAL}${neutralizeSpecialTokens(value)}`
}

function inputElement(text: string, sourceLang: string | undefined): string {
  const lang = sourceLang ? attribute('lang', sourceLang) : ''
  return `${TAG}input${lang}${MSG}${neutralizeSpecialTokens(text)}`
}

function outputElement(targetLang: string, form: JapaneseForm | undefined, text: string): string {
  const formAttribute = form ? attribute('form', form) : ''
  return `${TAG}output${attribute('lang', targetLang)}${formAttribute}${MSG}${neutralizeSpecialTokens(text)}`
}

/** PFML3 の文字列を組み立てる。返した文字列の直後から、モデルが訳文を生成する。 */
export function buildPfml3Prompt(request: Pfml3Request): string {
  const { source, targetLang, sourceLang, context, glossary, history, form } = request

  if (source.length === 0) {
    throw new Error('原文が空です')
  }
  if (targetLang.length === 0) {
    throw new Error('訳先の言語コード(targetLang)は必須です')
  }
  if (form !== undefined && targetLang !== 'ja') {
    throw new Error('文体(form)は、訳先の言語が "ja" のときだけ指定できます')
  }

  const parts: string[] = [`${TAG}dataset${MSG}translation`]

  if (context) {
    parts.push(`${TAG}context${MSG}${neutralizeSpecialTokens(context)}`)
  }

  for (const pair of history ?? []) {
    parts.push(inputElement(pair.source, sourceLang))
    // 文体と用語集は今回の訳文だけに適用されるため、履歴の output には言語だけを書く。
    parts.push(outputElement(targetLang, undefined, pair.translation))
  }

  if (glossary && glossary.length > 0) {
    const entries = glossary
      .map((entry) => `${INDEX}${neutralizeSpecialTokens(entry.source)}${ITEM}${neutralizeSpecialTokens(entry.target)}`)
      .join('')
    parts.push(`${TAG}glossary${entries}`)
  }

  parts.push(inputElement(source, sourceLang))
  parts.push(outputElement(targetLang, form, ''))

  return parts.join('')
}

/** モデルの出力から、末尾に残った終了の特殊トークンと前後の空白を取り除く。 */
export function cleanPfml3Output(output: string): string {
  let text = output
  let removed = true
  while (removed) {
    removed = false
    const trimmed = text.trimEnd()
    for (const marker of PFML3_END_MARKERS) {
      if (trimmed.endsWith(marker)) {
        text = trimmed.slice(0, -marker.length)
        removed = true
        break
      }
    }
  }
  return text.trim()
}
