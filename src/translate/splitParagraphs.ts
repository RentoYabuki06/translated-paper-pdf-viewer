/**
 * 貼り付けられた文章を、翻訳の単位である段落に分ける。
 *
 * 空行(空白だけの行を含む)を段落の区切りとする。
 * 段落の中の改行は、空白 1 つに置き換える。
 * PDF から写した文章は、行の折り返しの位置に改行が入っているためである。
 */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[^\S\n]*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
}
