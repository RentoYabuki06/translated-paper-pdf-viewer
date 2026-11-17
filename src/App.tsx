import { useState } from 'react'
import { describeTarget } from './translate/settings.ts'
import { GlossaryPanel } from './viewer/GlossaryPanel.tsx'
import { GlossaryProvider } from './viewer/GlossaryProvider.tsx'
import { PasteTranslate } from './viewer/PasteTranslate.tsx'
import { PdfViewer } from './viewer/PdfViewer.tsx'
import { ServerPanel } from './viewer/ServerPanel.tsx'
import { TranslatorProvider } from './viewer/TranslatorProvider.tsx'
import { useTranslator } from './viewer/translatorContext.ts'

type Tab = 'pdf' | 'paste' | 'glossary' | 'server'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pdf', label: 'PDF を開く' },
  { id: 'paste', label: '文章を貼り付けて訳す' },
  { id: 'glossary', label: '用語集' },
  { id: 'server', label: '翻訳サーバー' },
]

/** 翻訳サーバーとの接続の状態を、短く表示する。押すと、設定の画面に切り替わる。 */
function ConnectionBadge({ onOpen }: { onOpen: () => void }) {
  const { settings, connection } = useTranslator()
  const text =
    connection.state === 'ok'
      ? `接続済み: ${connection.info.modelId}`
      : connection.state === 'error'
        ? '接続できません'
        : connection.state === 'checking'
          ? '確かめています…'
          : '未確認'
  return (
    <button type="button" className={`badge ${connection.state}`} onClick={onOpen} title="翻訳サーバーの設定を開く">
      {describeTarget(settings)} — {text}
    </button>
  )
}

export function App() {
  const [tab, setTab] = useState<Tab>('pdf')

  return (
    <TranslatorProvider>
      <GlossaryProvider>
        <main className="app">
          <h1>翻訳論文 PDF ビューア</h1>
          <nav className="tabs">
            {TABS.map(({ id, label }) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
            <ConnectionBadge onOpen={() => setTab('server')} />
          </nav>

          {/* 画面を切り替えても入力や開いた PDF が消えないよう、すべてを描画したまま表示だけを切り替える。 */}
          <div hidden={tab !== 'pdf'}>
            <PdfViewer onOpenServerSettings={() => setTab('server')} onOpenGlossary={() => setTab('glossary')} />
          </div>
          <div hidden={tab !== 'paste'}>
            <PasteTranslate onOpenServerSettings={() => setTab('server')} onOpenGlossary={() => setTab('glossary')} />
          </div>
          <div hidden={tab !== 'glossary'}>
            <GlossaryPanel />
          </div>
          <div hidden={tab !== 'server'}>
            <ServerPanel />
          </div>

          <footer className="status">Built with PLaMo</footer>
        </main>
      </GlossaryProvider>
    </TranslatorProvider>
  )
}
