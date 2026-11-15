import { useEffect, useRef, useState } from 'react'
import { mapWithConcurrency } from '../lib/pool.ts'
import type { BackendInfo, StopReason } from '../translate/backend.ts'
import { DEFAULT_LLAMA_SERVER_URL, LlamaServerBackend } from '../translate/llamaServer.ts'
import { splitParagraphs } from '../translate/splitParagraphs.ts'

/** llama-server の URL を、ブラウザに覚えさせておくときの名前。 */
const SERVER_URL_STORAGE_KEY = 'llamaServerUrl'

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

type Connection =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; info: BackendInfo }
  | { state: 'error'; message: string }

interface Summary {
  seconds: number
  outputTokens: number
}

function loadServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_URL_STORAGE_KEY) ?? DEFAULT_LLAMA_SERVER_URL
  } catch {
    return DEFAULT_LLAMA_SERVER_URL
  }
}

function saveServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, url)
  } catch {
    // 保存できない場合(プライベートウィンドウなど)は、今回の入力だけを使う。
  }
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

export function PasteTranslate() {
  const [serverUrl, setServerUrl] = useState(loadServerUrl)
  const [connection, setConnection] = useState<Connection>({ state: 'idle' })
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

  async function checkConnection(): Promise<BackendInfo | null> {
    setConnection({ state: 'checking' })
    saveServerUrl(serverUrl)
    try {
      const info = await new LlamaServerBackend({ baseUrl: serverUrl }).info()
      setConnection({ state: 'ok', info })
      return info
    } catch (error) {
      setConnection({ state: 'error', message: messageOf(error) })
      return null
    }
  }

  async function translateAll(): Promise<void> {
    const sources = splitParagraphs(sourceText)
    if (sources.length === 0) return

    setRunning(true)
    setSummary(null)
    setParagraphs(sources.map((source) => ({ source, translation: '', status: 'waiting' })))

    const info = await checkConnection()
    if (!info) {
      setParagraphs([])
      setRunning(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    const backend = new LlamaServerBackend({ baseUrl: serverUrl })
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
        <label htmlFor="server-url">llama-server の URL</label>
        <div className="row">
          <input
            id="server-url"
            type="url"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            disabled={running}
            spellCheck={false}
          />
          <button type="button" onClick={() => void checkConnection()} disabled={running}>
            接続を確かめる
          </button>
        </div>
        <p className="status" role="status">
          {connection.state === 'idle' && '接続は、まだ確かめていません。'}
          {connection.state === 'checking' && '確かめています…'}
          {connection.state === 'ok' &&
            `接続できました。モデル: ${connection.info.modelId}、同時処理数: ${connection.info.slots}、文脈の長さ: ${
              connection.info.contextPerSlot ?? '不明'
            }`}
          {connection.state === 'error' && <span className="error">{connection.message}</span>}
        </p>
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
