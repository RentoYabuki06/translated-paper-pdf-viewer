import { useState } from 'react'
import { ConnectionBadge } from './viewer/ConnectionBadge.tsx'
import { GlossaryPanel } from './viewer/GlossaryPanel.tsx'
import { GlossaryProvider } from './viewer/GlossaryProvider.tsx'
import { PasteTranslate } from './viewer/PasteTranslate.tsx'
import { PdfViewer } from './viewer/PdfViewer.tsx'
import { ServerPanel } from './viewer/ServerPanel.tsx'
import { TranslatorProvider } from './viewer/TranslatorProvider.tsx'

type Tab = 'pdf' | 'paste' | 'glossary' | 'server'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pdf', label: 'PDF を開く' },
  { id: 'paste', label: '文章を貼り付けて訳す' },
  { id: 'glossary', label: '用語集' },
  { id: 'server', label: '翻訳サーバー' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('pdf')
  /** 左のメニュー(画面の切り替えと、開いた PDF の履歴)を開いているかどうか。 */
  const [menuOpen, setMenuOpen] = useState(false)
  /** メニューの中の、履歴を置く場所。PdfViewer が、ここに履歴の一覧を描く。 */
  const [historySlot, setHistorySlot] = useState<HTMLDivElement | null>(null)

  return (
    <TranslatorProvider>
      <GlossaryProvider>
        {/* 画面の左上に置く、メニューを開くボタン。 */}
        <button
          type="button"
          className="menu-button"
          onClick={() => setMenuOpen((current) => !current)}
          aria-expanded={menuOpen}
          aria-controls="menu-panel"
          aria-label="メニュー(画面の切り替えと、開いた PDF の履歴)"
          title="メニュー(画面の切り替えと、開いた PDF の履歴)"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* 閉じている間も、履歴を置く場所を残すため、隠すだけにする。 */}
        <aside id="menu-panel" className="menu" hidden={!menuOpen} aria-label="メニュー">
          <div className="menu-head">
            <strong>メニュー</strong>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="メニューを閉じる">
              ×
            </button>
          </div>
          <nav className="menu-nav">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id)
                  setMenuOpen(false)
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div ref={setHistorySlot} />
        </aside>

        <main className="app">
          <header className="app-head">
            <h1>翻訳論文 PDF ビューア</h1>
            <ConnectionBadge onOpen={() => setTab('server')} />
          </header>

          {/* 画面を切り替えても入力や開いた PDF が消えないよう、すべてを描画したまま表示だけを切り替える。 */}
          <div hidden={tab !== 'pdf'}>
            <PdfViewer
              onOpenGlossary={() => setTab('glossary')}
              historySlot={historySlot}
              onSelectHistory={() => {
                setTab('pdf')
                setMenuOpen(false)
              }}
            />
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
