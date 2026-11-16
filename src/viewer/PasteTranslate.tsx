import { useEffect, useRef, useState } from 'react'
import { mapWithConcurrency } from '../lib/pool.ts'
import type { StopReason } from '../translate/backend.ts'
import { describeTarget } from '../translate/settings.ts'
import { splitParagraphs } from '../translate/splitParagraphs.ts'
import { useTranslator } from './translatorContext.ts'

/** 1 段落の訳文の長さの上限(トークン数)。実験用のコマンドと同じ値。 */
const MAX_TOKENS = 1024

const SAMPLE_TEXT = `Transformers have become the dominant architecture for sequence modeling.
Unlike recurrent networks, they process all tokens in parallel and rely on
attention to capture long-range dependencies.

In this paper, we study how the choice of positional encoding affects
generalization to sequences longer than those seen during training. We find
that relative encodings extrapolate better than absolute ones.`

type ParagraphStatus = 'waiting' | 'running' | 'done' | 'error' | 'cancelled'

interface ParagraphState {
  source: string
  translation: string
  status: ParagraphStatus
  stopReason?: StopReason
  outputTokens?: number | null
  error?: string
}

interface Summary {
  seconds: number
  outputTokens: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const STATUS_LABEL: Record<ParagraphStatus, string> = {
  waiting: '待機中',
  running: '翻訳中',
  done: '完了',
  error: '失敗',
  cancelled: '中止',
}

interface Props {
  /** 翻訳サーバーの設定の画面を開く。 */
  onOpenServerSettings: () => void
}

export function PasteTranslate({ onOpenServerSettings }: Props) {
  const translator = useTranslator()
  /** 翻訳を始められなかった理由。 */
  const [startError, setStartError] = useState<string | null>(null)
  const [sourceText, setSourceText] = useState(SAMPLE_TEXT)
  const [paragraphs, setParagraphs] = useState<ParagraphState[]>([])
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 画面を閉じるときに、進行中の依頼を取り消す。
  useEffect(() => () => abortRef.current?.abort(), [])

  function updateParagraph(index: number, patch: Partial<ParagraphState>): void {
    setParagraphs((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function translateAll(): Promise<void> {
    const sources = splitParagraphs(sourceText)
    if (sources.length === 0) return

    setRunning(true)
    setSummary(null)
    setStartError(null)
    setParagraphs(sources.map((source) => ({ source, translation: '', status: 'waiting' })))

    // 翻訳サーバーに接続できることを、先に確かめる。設定は「翻訳サーバー」の画面のものを使う。
    const connected = await translator.check()
    if (!connected.ok) {
      setStartError(`翻訳サーバーに接続できません。「翻訳サーバー」の画面で、設定を確かめてください。(${connected.message})`)
      setParagraphs([])
      setRunning(false)
      return
    }
    const { backend, info } = connected

    const controller = new AbortController()
    abortRef.current = controller
    const started = performance.now()
    let outputTokens = 0

    // 同時に依頼する数は、サーバーが同時に処理できる数に合わせる。
    await mapWithConcurrency(sources, info.slots, async (source, index) => {
      if (controller.signal.aborted) {
        updateParagraph(index, { status: 'cancelled' })
        return
      }
      updateParagraph(index, { status: 'running' })
      try {
        const result = await backend.translate(
          { source, sourceLang: 'en', targetLang: 'ja', form: 'plain', maxTokens: MAX_TOKENS },
          { signal: controller.signal, onText: (translation) => updateParagraph(index, { translation }) },
        )
        outputTokens += result.outputTokens ?? 0
        updateParagraph(index, {
          translation: result.text,
          status: 'done',
          stopReason: result.stopReason,
          outputTokens: result.outputTokens,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          updateParagraph(index, { status: 'cancelled' })
        } else {
          // 1 段落の失敗で、ほかの段落の翻訳を止めない。
          updateParagraph(index, { status: 'error', error: messageOf(error) })
        }
      }
    })

    setSummary({ seconds: (performance.now() - started) / 1000, outputTokens })
    abortRef.current = null
    setRunning(false)
  }

  const paragraphCount = splitParagraphs(sourceText).length

  return (
    <>
      <p>英語の文章を貼り付けて、PLaMo 3 Translate の訳文を確かめます。</p>

      <section className="panel">
        <div className="row">
          <span className="status">依頼先: {describeTarget(translator.settings)}</span>
          <button type="button" onClick={onOpenServerSettings} disabled={running}>
            設定
          </button>
        </div>
        {startError && (
          <p className="status" role="status">
            <span className="error">{startError}</span>
          </p>
        )}
      </section>

      <section className="panel">
        <label htmlFor="source-text">英語の原文(空行で段落を区切ります)</label>
        <textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          rows={10}
          disabled={running}
          spellCheck={false}
        />
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void translateAll()}
            disabled={running || paragraphCount === 0}
          >
            翻訳する({paragraphCount} 段落)
          </button>
          <button type="button" onClick={() => abortRef.current?.abort()} disabled={!running}>
            中止
          </button>
          {summary && (
            <span className="status">
              {summary.seconds.toFixed(1)} 秒、{summary.outputTokens} トークン
              {summary.seconds > 0 && `(${(summary.outputTokens / summary.seconds).toFixed(1)} トークン毎秒)`}
            </span>
          )}
        </div>
      </section>

      {paragraphs.length > 0 && (
        <section className="results">
          {paragraphs.map((paragraph, index) => (
            <article key={index} className="pair">
              <p lang="en">{paragraph.source}</p>
              <div>
                <p lang="ja">{paragraph.translation}</p>
                <p className="status">
                  {STATUS_LABEL[paragraph.status]}
                  {paragraph.status === 'done' && paragraph.outputTokens != null && `(${paragraph.outputTokens} トークン)`}
                  {paragraph.stopReason === 'limit' && (
                    <span className="error"> 長さの上限に達したため、訳文が途中で切れています。</span>
                  )}
                  {paragraph.error && <span className="error"> {paragraph.error}</span>}
                </p>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  )
}
