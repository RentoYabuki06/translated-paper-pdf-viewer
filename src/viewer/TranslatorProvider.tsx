/**
 * 翻訳サーバーの設定と、接続の状態を持ち、配下の画面の部品に渡す。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { checkBackend, CONNECTION_TIMEOUT_MS } from '../translate/connection.ts'
import { OllamaBackend } from '../translate/ollama.ts'
import { connectionWarnings, createBackend, describeTarget, loadSettings, saveSettings } from '../translate/settings.ts'
import type { TranslatorSettings } from '../translate/settings.ts'
import { TranslatorContext } from './translatorContext.ts'
import type { CheckResult, Connection } from './translatorContext.ts'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function TranslatorProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TranslatorSettings>(loadSettings)
  const [connection, setConnection] = useState<Connection>({ state: 'idle' })
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)
  /** 最新の設定。確認の処理が、描画を待たずに読めるようにする。 */
  const settingsRef = useRef(settings)
  /** 確認の通し番号。あとから始めた確認の結果だけを、画面に反映するために使う。 */
  const sequence = useRef(0)

  const updateSettings = useCallback((patch: Partial<TranslatorSettings>) => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    saveSettings(next)
    setSettings(next)
    // 進行中の確認があっても、古い設定の結果は反映しない。
    sequence.current += 1
    setConnection({ state: 'idle' })
  }, [])

  const check = useCallback(async (): Promise<CheckResult> => {
    const current = settingsRef.current
    const id = ++sequence.current
    setConnection({ state: 'checking' })

    // Ollama では、入っているモデルの一覧も取り直す。モデルの名前を選べるようにするためである。
    if (current.kind === 'ollama') {
      new OllamaBackend({ baseUrl: current.ollamaUrl, model: '' }).listModels(AbortSignal.timeout(CONNECTION_TIMEOUT_MS)).then(
        (models) => {
          if (id === sequence.current) setOllamaModels(models)
        },
        () => {
          if (id === sequence.current) setOllamaModels(null)
        },
      )
    }

    const backend = createBackend(current)
    try {
      // 応答が返らない場合に、確認が終わらないままにならないよう、待つ時間に上限がある(connection.ts)。
      const info = await checkBackend(backend, describeTarget(current))
      if (id === sequence.current) setConnection({ state: 'ok', info, warnings: connectionWarnings(current.kind, info) })
      return { ok: true, info, backend }
    } catch (error) {
      const message = messageOf(error)
      if (id === sequence.current) setConnection({ state: 'error', message })
      return { ok: false, message }
    }
  }, [])

  // 画面を開いたときに、保存してある設定で 1 回確かめる。
  useEffect(() => {
    void check()
  }, [check])

  const value = useMemo(
    () => ({ settings, updateSettings, connection, ollamaModels, check }),
    [settings, updateSettings, connection, ollamaModels, check],
  )
  return <TranslatorContext.Provider value={value}>{children}</TranslatorContext.Provider>
}
