/**
 * 数式の目印を含む原文を訳す。
 *
 * 訳文は、原文の目印がちょうど 1 回ずつ残っている場合だけ採用する。
 * そろわない場合は、文ごとに分けて訳し直す。それでもそろわなければ、訳文を採用しない。
 * 数式を正しい位置に戻せない訳文を表示するより、原文のまま残すほうが、情報が失われないためである。
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
