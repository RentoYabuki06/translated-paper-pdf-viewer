/**
 * 用語集を編集する画面。
 *
 * 原文の語と、その訳語の組を登録する。
 * 登録した語は、その語が出てくる段落の翻訳の依頼に、訳語の指定として付く(glossary.ts)。
 */

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { MAX_GLOSSARY_ROWS, MAX_TERM_LENGTH, termKey } from '../translate/glossary.ts'
import type { RowProblem } from '../translate/glossary.ts'
import type { GlossaryEntry } from '../translate/pfml3.ts'
import { useGlossary } from './glossaryContext.ts'

/** 行が翻訳に使われない理由の表示。入力の前の行(empty)には、何も表示しない。 */
const PROBLEM_LABELS: Record<RowProblem, string> = {
  empty: '',
  'no-source': '原文の語が空のため、翻訳に使われません。',
  'no-target': '訳語が空のため、翻訳に使われません。',
  duplicate: '上の行と同じ語のため、翻訳に使われません。',
}

export function GlossaryPanel() {
  const { rows, setRows, entries, problems } = useGlossary()
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const sourceInput = useRef<HTMLInputElement>(null)

  function add(event: FormEvent): void {
    event.preventDefault()
    const term = source.trim().replace(/\s+/g, ' ')
    const translation = target.trim()
    const key = termKey(term)
    if (key.length === 0 || translation.length === 0) return
    if (rows.length >= MAX_GLOSSARY_ROWS) {
      setMessage(`登録できるのは ${MAX_GLOSSARY_ROWS} 行までです。使わない行を削除してから、追加してください。`)
      return
    }
    if (rows.some((row) => termKey(row.source) === key)) {
      setMessage(`「${term}」は、すでに登録されています。訳語を変える場合は、下の一覧で書き換えてください。`)
      return
    }
    setRows([...rows, { source: term, target: translation }])
    setSource('')
    setTarget('')
    setMessage(null)
    sourceInput.current?.focus()
  }

  function change(index: number, patch: Partial<GlossaryEntry>): void {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function remove(index: number): void {
    setRows(rows.filter((_, i) => i !== index))
  }

  return (
    <>
      <p>
        原文の語と、その訳語の組を登録します。登録した語が出てくる段落では、翻訳のモデルに、その訳語を使うよう指定します。用語集は、このブラウザに保存されます。
      </p>

      <section className="panel">
        <form className="row" onSubmit={add}>
          <input
            ref={sourceInput}
            type="text"
            value={source}
            onChange={(event) => {
              setSource(event.target.value)
              setMessage(null)
            }}
            placeholder="原文の語(例: attention)"
            aria-label="追加する原文の語"
            maxLength={MAX_TERM_LENGTH}
            spellCheck={false}
          />
          <input
            type="text"
            lang="ja"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value)
              setMessage(null)
            }}
            placeholder="訳語(例: 注意)"
            aria-label="追加する訳語"
            maxLength={MAX_TERM_LENGTH}
            spellCheck={false}
          />
          <button type="submit" className="primary" disabled={termKey(source).length === 0 || target.trim().length === 0}>
            追加
          </button>
        </form>
        {message && (
          <p className="status" role="status">
            <span className="error">{message}</span>
          </p>
        )}
      </section>

      <section className="panel">
        {rows.length === 0 ? (
          <p className="status">登録した語は、まだありません。</p>
        ) : (
          <>
            <table className="glossary">
              <thead>
                <tr>
                  <th scope="col">原文の語</th>
                  <th scope="col">訳語</th>
                  <th scope="col" className="actions">
                    <span className="visually-hidden">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const problem = problems[index] ?? null
                  return (
                    // 行には、変わらない名前が無い。入力欄の内容は rows から決まるので、番号を key にしてよい。
                    <tr key={index}>
                      <td>
                        <input
                          type="text"
                          value={row.source}
                          onChange={(event) => change(index, { source: event.target.value })}
                          aria-label={`${index + 1} 行目の原文の語`}
                          maxLength={MAX_TERM_LENGTH}
                          spellCheck={false}
                        />
                        {problem && PROBLEM_LABELS[problem] && (
                          <p className="status">
                            <span className="error">{PROBLEM_LABELS[problem]}</span>
                          </p>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          lang="ja"
                          value={row.target}
                          onChange={(event) => change(index, { target: event.target.value })}
                          aria-label={`${index + 1} 行目の訳語`}
                          maxLength={MAX_TERM_LENGTH}
                          spellCheck={false}
                        />
                      </td>
                      <td className="actions">
                        <button type="button" onClick={() => remove(index)} aria-label={`${index + 1} 行目を削除`}>
                          削除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="status" role="status">
              登録した {rows.length} 行のうち、翻訳に使われるのは {entries.length} 行です。
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <p className="status">登録のしかたと、気を付ける点:</p>
        <ul className="hints">
          <li>
            訳語の指定は、登録した語が出てくる段落の依頼にだけ付きます。用語集を変えたあとで「この PDF
            を翻訳する」を押すと、指定が変わる段落だけを訳し直します。
          </li>
          <li>
            語は、単数形で登録します。複数形(語尾に s か es が付いた形と、語尾の y が ies
            に変わった形)にも当てはまります。語と語の間の空白とハイフンは、区別しません。
          </li>
          <li>
            大文字と小文字は、区別しません。ただし、2 文字目以降に大文字がある語(RNN、CLIP
            など)は、略語とみなして、大文字と小文字が同じ場合にだけ当てはめます。
          </li>
          <li>訳語に、原文と同じ語を書くと、その語を英語のまま残せます。</li>
          <li>
            訳語の指定は、必ず守られるとは限りません。確かめた範囲では、略語を日本語の名前に置き換える指定(RNN
            に「再帰型ニューラルネットワーク」など)は、守られませんでした。指定した訳語に、別の語が足されることもあります(「注意」が「注意機構」になるなど)。
          </li>
        </ul>
      </section>
    </>
  )
}
