import type { MathSentence } from '../data/mathSentences.ts'

/** 文のひな形の {0}、{1} … を、対応する文字列に置き換える。 */
export function fillTemplate(template: string, replacements: readonly string[]): string {
  return template.replace(/\{(\d+)\}/g, (whole, digits: string) => replacements[Number(digits)] ?? whole)
}

/** 数式を文字のまま埋め込んだ文にする(数式の目印を使わない場合の原文)。 */
export function plainSentence(sentence: MathSentence): string {
  return fillTemplate(sentence.template, sentence.math)
}

/**
 * 文を順番に取り出して、決まった文数の段落を作る。文が足りなくなったら先頭に戻る。
 * 生成速度の測定用。段落の内容のつながりは問わない。
 */
export function buildParagraphs(
  sentences: readonly MathSentence[],
  paragraphCount: number,
  sentencesPerParagraph: number,
): string[] {
  if (sentences.length === 0) throw new Error('文が 1 件もありません')
  const paragraphs: string[] = []
  for (let p = 0; p < paragraphCount; p += 1) {
    const parts: string[] = []
    for (let s = 0; s < sentencesPerParagraph; s += 1) {
      const sentence = sentences[(p * sentencesPerParagraph + s) % sentences.length] as MathSentence
      parts.push(plainSentence(sentence))
    }
    paragraphs.push(parts.join(' '))
  }
  return paragraphs
}
