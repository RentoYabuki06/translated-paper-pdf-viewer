/**
 * 数式の目印を含む原文を訳す。
 *
 * 訳文は、原文の目印がちょうど 1 回ずつ残っている場合だけ採用する。
 * そろわない場合は、文ごとに分けて訳し直す。それでもそろわなければ、訳文を採用しない。
 * 数式を正しい位置に戻せない訳文を表示するより、原文のまま残すほうが、情報が失われないためである。
 *
 * 用語集を付けた依頼でそろわなかった場合は、用語集を付けずに、同じ手順をもう一度行う(translateTaggedWithGlossary)。
 */

import { checkTags, tagIds } from '../math/placeholders.ts'
import { splitSentences } from './sentences.ts'

export interface RequestResult {
  /** 訳文。目印の表記ゆれは、直してあること。 */
  text: string
  /** 長さの上限に達して、訳文が途中で切れている場合に true。 */
  truncated: boolean
}

export type TaggedResult =
  /** 訳文を採用した。retried は、文ごとに訳し直した場合に true。 */
  | { status: 'ok'; text: string; truncated: boolean; retried: boolean }
  /** 目印がそろわなかったため、訳文を採用しない。 */
  | { status: 'kept' }

/**
 * 原文を訳す。request は、原文 1 つを訳して返す関数。
 * 目印を含まない原文は、検査をせずに、訳文をそのまま採用する。
 */
export async function translateTagged(
  source: string,
  request: (source: string) => Promise<RequestResult>,
): Promise<TaggedResult> {
  const whole = await request(source)
  if (checkTags(whole.text, tagIds(source)).ok) {
    return { status: 'ok', text: whole.text, truncated: whole.truncated, retried: false }
  }

  const sentences = splitSentences(source)
  if (sentences.length < 2) return { status: 'kept' }
  let joined = ''
  for (const sentence of sentences) {
    const result = await request(sentence)
    if (result.truncated || !checkTags(result.text, tagIds(sentence)).ok) return { status: 'kept' }
    joined += result.text
  }
  return { status: 'ok', text: joined, truncated: false, retried: true }
}

/** 用語集を付けて訳した結果。glossaryDropped は、用語集を付けずに訳し直した訳文を採用した場合に true。 */
export type GlossaryTaggedResult =
  | { status: 'ok'; text: string; truncated: boolean; retried: boolean; glossaryDropped: boolean }
  | { status: 'kept' }

/**
 * 用語集を付けて原文を訳す。目印がそろわなければ、用語集を付けずに訳し直す。
 *
 * 用語集を付けると訳文が変わり、付けなければそろっていた目印が、そろわなくなることがある(note/024_glossary.md)。
 * 訳語の指定が反映されなくても、原文のまま残すよりは読めるので、その場合は、用語集を付けない訳文を採用する。
 *
 * request は、原文 1 つを訳して返す関数。2 つ目の引数が true の場合は用語集を付け、false の場合は付けない。
 * hasGlossary には、この原文に付ける用語集の項目があるかどうかを渡す。
 * 無い場合は、訳し直さない。用語集を付けても付けなくても、同じ依頼になるためである。
 */
export async function translateTaggedWithGlossary(
  source: string,
  hasGlossary: boolean,
  request: (source: string, withGlossary: boolean) => Promise<RequestResult>,
): Promise<GlossaryTaggedResult> {
  const guided = await translateTagged(source, (text) => request(text, true))
  if (guided.status === 'ok') return { ...guided, glossaryDropped: false }
  if (!hasGlossary) return guided
  const plain = await translateTagged(source, (text) => request(text, false))
  return plain.status === 'ok' ? { ...plain, glossaryDropped: true } : plain
}
