import { LlamaServerError } from '../../src/translate/llamaServer.ts'

/** 利用者の指定の誤り。内部の呼び出し履歴は出さず、メッセージだけを表示する。 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** "--name value" で受け取った文字列を、1 以上の整数として読む。 */
export function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`${name} には 1 以上の整数を指定してください: ${value}`)
  }
  return parsed
}

/**
 * スクリプトの本体を実行する。
 * 失敗した場合は、原因を表示して終了コード 1 で終える。
 * 指定の誤りと llama-server に起因する失敗は、利用者が対処できるよう、短い案内だけを表示する。
 */
export async function runMain(main: () => Promise<void>): Promise<void> {
  try {
    await main()
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
    } else if (error instanceof LlamaServerError) {
      console.error(error.message)
      console.error('llama-server は npm run model で起動できます。')
    } else {
      console.error(error)
    }
    process.exit(1)
  }
}
