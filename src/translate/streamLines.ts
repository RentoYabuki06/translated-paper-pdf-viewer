/**
 * 逐次届く応答の本文を、1 行ずつ取り出す。
 *
 * 通信の区切りは、行や文字の途中に入りうる。行がそろうまで溜めてから返す。
 * llama-server(Server-Sent Events)と Ollama(1 行に 1 つの JSON)の、どちらの応答にも使う。
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        yield buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    const rest = buffer.replace(/\r$/, '')
    if (rest.length > 0) yield rest
  } finally {
    // 途中で読むのをやめた場合に、サーバーとの接続を閉じる。
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
