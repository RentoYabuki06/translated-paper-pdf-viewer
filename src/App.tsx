import { useState } from 'react'
import { PasteTranslate } from './viewer/PasteTranslate.tsx'
import { PdfViewer } from './viewer/PdfViewer.tsx'

type Tab = 'pdf' | 'paste'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pdf', label: 'PDF を開く' },
  { id: 'paste', label: '文章を貼り付けて訳す' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('pdf')

  return (
    <main className="app">
      <h1>翻訳論文 PDF ビューア</h1>
      <nav className="tabs">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {/* 画面を切り替えても入力や開いた PDF が消えないよう、両方を描画したまま表示だけを切り替える。 */}
      <div hidden={tab !== 'pdf'}>
        <PdfViewer />
      </div>
      <div hidden={tab !== 'paste'}>
        <PasteTranslate />
      </div>

      <footer className="status">Built with PLaMo</footer>
    </main>
  )
}
