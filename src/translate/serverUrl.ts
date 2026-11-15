/**
 * llama-server の URL を、ブラウザに覚えさせる。「PDF を開く」と「文章を貼り付けて訳す」で共通に使う。
 */

import { DEFAULT_LLAMA_SERVER_URL } from './llamaServer.ts'

const STORAGE_KEY = 'llamaServerUrl'

export function loadServerUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_LLAMA_SERVER_URL
  } catch {
    return DEFAULT_LLAMA_SERVER_URL
  }
}

export function saveServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url)
  } catch {
    // 保存できない場合(プライベートウィンドウなど)は、今回の入力だけを使う。
  }
}
