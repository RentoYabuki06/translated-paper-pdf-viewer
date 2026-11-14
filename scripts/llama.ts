/**
 * PLaMo 3 Translate を載せた llama-server を起動する。
 *
 * 使い方:
 *   npm run model                     2B を起動する
 *   npm run model -- 8b               8B を起動する
 *   npm run model -- 2b --port 8081   ポート番号を変える
 *   npm run model -- --dry-run        起動せずに、実行するコマンドだけを表示する
 */

import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { gguf } from '@huggingface/gguf'
import {
  buildLlamaServerArguments,
  DEFAULT_MODEL_SIZE,
  DEFAULT_PARALLEL,
  DEFAULT_PORT,
  DEFAULT_QUANT,
  ggufFileUrl,
  isModelSize,
  MODEL_SIZES,
} from './lib/llamaArgs.ts'
import { yarnRangeArguments } from './lib/yarn.ts'

const EXECUTABLE = process.env.LLAMA_SERVER ?? 'llama-server'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) fail(`${name} には整数を指定してください: ${value}`)
  return parsed
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: String(DEFAULT_PORT) },
    parallel: { type: 'string', default: String(DEFAULT_PARALLEL) },
    quant: { type: 'string', default: DEFAULT_QUANT },
    'dry-run': { type: 'boolean', default: false },
  },
})

const size = positionals[0] ?? DEFAULT_MODEL_SIZE
if (!isModelSize(size)) {
  fail(`モデルの大きさは ${MODEL_SIZES.join('、')} のいずれかで指定してください: ${size}`)
}
const port = parseInteger(values.port, '--port')
const parallel = parseInteger(values.parallel, '--parallel')
const dryRun = values['dry-run']

if (!dryRun) {
  const probe = spawnSync(EXECUTABLE, ['--version'], { stdio: 'ignore' })
  if (probe.error) {
    fail(
      [
        `${EXECUTABLE} が見つかりません。`,
        'llama.cpp を導入してください(例: brew install llama.cpp)。',
        '別の場所にある場合は、環境変数 LLAMA_SERVER に実行ファイルのパスを指定してください。',
      ].join('\n'),
    )
  }
}

// GGUF の先頭部分だけを Hugging Face から読み、位置符号化の補正値を計算する。
const url = ggufFileUrl(size, values.quant)
console.error(`モデルの情報を読んでいます: ${url}`)
let yarnArguments: string[]
try {
  const { metadata } = await gguf(url)
  yarnArguments = yarnRangeArguments(metadata)
} catch (error) {
  fail(`モデルの情報を読めませんでした。大きさと量子化の指定、ネットワークを確認してください。\n${String(error)}`)
}

const args = buildLlamaServerArguments({ size, quant: values.quant, port, parallel, yarnArguments })
console.error(`${EXECUTABLE} ${args.join(' ')}`)

if (dryRun) {
  process.exit(0)
}

const child = spawn(EXECUTABLE, args, { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
child.on('error', (error) => fail(`${EXECUTABLE} を起動できませんでした: ${error.message}`))
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
