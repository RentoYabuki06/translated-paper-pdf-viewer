/**
 * 開いた PDF の履歴。ブラウザ内蔵のデータベース(IndexedDB)に、PDF のファイルそのものを置く。
 *
 * 履歴から選ぶと、ファイルを選び直さずに、同じ PDF を開ける。
 * 訳文は、別の保存先(translate/cache.ts)にあるので、開き直すと、保存してある訳文がそのまま使われる。
 * データは、このブラウザの中だけにあり、どこにも送らない。
 */

export interface HistoryEntry {
  /** PDF を見分ける値。PDF.js が、ファイルの内容から求める(fingerprint)。 */
  id: string
  /** 表示する名前。ファイルの名前、または arXiv:<ID>。 */
  name: string
  pages: number
  /** ファイルの大きさ(バイト)。 */
  bytes: number
  /** 最後に開いた時刻(ミリ秒)。 */
  openedAt: number
}

/** 履歴に残す PDF の数の上限。超えた分は、最後に開いた時刻の古いものから消す。 */
export const MAX_HISTORY = 30

/** 最後に開いた時刻の新しい順に並べる。 */
export function sortEntries(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.openedAt - a.openedAt)
}

/** 上限を超えた分の、消す PDF の id。最後に開いた時刻の古いものから選ぶ。 */
export function overflowIds(entries: readonly HistoryEntry[], max = MAX_HISTORY): string[] {
  return sortEntries(entries)
    .slice(Math.max(max, 0))
    .map((entry) => entry.id)
}

/** ファイルの大きさを、画面に出す文字列にする。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

/** 時刻を、画面に出す文字列にする。例: 2026/11/17 15:04 */
export function formatTime(time: number): string {
  const date = new Date(time)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

const DATABASE_NAME = 'translated-paper-pdf-viewer-history'
/** 一覧に出す情報。PDF のファイルとは別に置き、一覧を作るときに、ファイルを読まずに済ませる。 */
const ENTRY_STORE = 'entries'
const FILE_STORE = 'files'

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB の操作に失敗しました'))
  })
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB の操作に失敗しました'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB の操作が取り消されました'))
  })
}

export interface HistoryStore {
  /** 最後に開いた時刻の新しい順の一覧。 */
  list(): Promise<HistoryEntry[]>
  /** PDF を履歴に入れる。同じ PDF がすでにあれば、置き換える。上限を超えた分は消す。 */
  save(entry: HistoryEntry, data: ArrayBuffer): Promise<void>
  /** PDF のファイルを取り出す。無ければ undefined。 */
  load(id: string): Promise<ArrayBuffer | undefined>
  remove(id: string): Promise<void>
}

let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  opening ??= (async () => {
    const open = indexedDB.open(DATABASE_NAME, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(ENTRY_STORE, { keyPath: 'id' })
      open.result.createObjectStore(FILE_STORE)
    }
    return promisify(open)
  })()
  // 開けなかった場合は、次の呼び出しで、もう一度試す。
  opening.catch(() => {
    opening = undefined
  })
  return opening
}

/** 履歴の保存先。IndexedDB が使えない場合(プライベートウィンドウなど)は、それぞれの操作が失敗する。 */
export const historyStore: HistoryStore = {
  async list() {
    const store = (await database()).transaction(ENTRY_STORE, 'readonly').objectStore(ENTRY_STORE)
    return sortEntries((await promisify(store.getAll())) as HistoryEntry[])
  },
  async save(entry, data) {
    const transaction = (await database()).transaction([ENTRY_STORE, FILE_STORE], 'readwrite')
    const entries = transaction.objectStore(ENTRY_STORE)
    const files = transaction.objectStore(FILE_STORE)
    const done = finished(transaction)
    entries.put(entry)
    files.put(data, entry.id)
    const all = (await promisify(entries.getAll())) as HistoryEntry[]
    for (const id of overflowIds(all)) {
      entries.delete(id)
      files.delete(id)
    }
    await done
  },
  async load(id) {
    const store = (await database()).transaction(FILE_STORE, 'readonly').objectStore(FILE_STORE)
    return (await promisify(store.get(id))) as ArrayBuffer | undefined
  },
  async remove(id) {
    const transaction = (await database()).transaction([ENTRY_STORE, FILE_STORE], 'readwrite')
    const done = finished(transaction)
    transaction.objectStore(ENTRY_STORE).delete(id)
    transaction.objectStore(FILE_STORE).delete(id)
    await done
  },
}
