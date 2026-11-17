import { describe, expect, it } from 'vitest'
import { buildLlamaServerArguments, ggufFileUrl, ggufRepository, isModelSize, modelAlias } from '../../scripts/lib/llamaArgs.ts'

describe('モデルの指定', () => {
  it('大きさからリポジトリ名とファイルの URL を作る', () => {
    expect(ggufRepository('2b')).toBe('pfnet/plamo-3-translate-2b-GGUF')
    expect(ggufFileUrl('0.8b', 'Q4_0')).toBe(
      'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q4_0.gguf',
    )
  })

  it('公開されている大きさだけを受け付ける', () => {
    expect(isModelSize('8b')).toBe(true)
    expect(isModelSize('4b')).toBe(false)
  })

  it('別名に、大きさと量子化の種類を含める', () => {
    expect(modelAlias('2b', 'Q4_K_M')).toBe('plamo-3-translate-2b-Q4_K_M')
    expect(modelAlias('0.8b', 'Q4_0')).toBe('plamo-3-translate-0.8b-Q4_0')
    // 大きさか量子化の種類が違えば、別名も違う。アプリは、訳文を別名ごとに分けて保存する。
    expect(modelAlias('8b', 'Q4_K_M')).not.toBe(modelAlias('2b', 'Q4_K_M'))
    expect(modelAlias('2b', 'Q3_K_M')).not.toBe(modelAlias('2b', 'Q4_K_M'))
  })
})

describe('buildLlamaServerArguments', () => {
  const yarnArguments = ['--yarn-beta-fast', '31.738495', '--yarn-beta-slow', '1.0040927']

  it('モデル、待ち受け先、同時処理数、補正値を引数にする', () => {
    const args = buildLlamaServerArguments({ size: '2b', quant: 'Q4_K_M', port: 8080, parallel: 4, yarnArguments })

    const valueOf = (flag: string) => args[args.indexOf(flag) + 1]
    expect(valueOf('-hf')).toBe('pfnet/plamo-3-translate-2b-GGUF:Q4_K_M')
    expect(valueOf('--alias')).toBe('plamo-3-translate-2b-Q4_K_M')
    expect(valueOf('--host')).toBe('127.0.0.1')
    expect(valueOf('--port')).toBe('8080')
    expect(valueOf('--parallel')).toBe('4')
    expect(valueOf('--yarn-beta-fast')).toBe('31.738495')
    expect(valueOf('--yarn-beta-slow')).toBe('1.0040927')
  })

  it('別名は、指定した大きさと量子化の種類のものにする', () => {
    const args = buildLlamaServerArguments({ size: '8b', quant: 'Q3_K_M', port: 8080, parallel: 4, yarnArguments })
    expect(args[args.indexOf('--alias') + 1]).toBe('plamo-3-translate-8b-Q3_K_M')
  })

  it('文脈の長さは、1 依頼の上限 2,048 トークンに同時処理数を掛けた値にする', () => {
    const argsFor = (parallel: number) =>
      buildLlamaServerArguments({ size: '2b', quant: 'Q4_K_M', port: 8080, parallel, yarnArguments })
    const ctxSizeOf = (args: string[]) => args[args.indexOf('--ctx-size') + 1]
    expect(ctxSizeOf(argsFor(4))).toBe('8192')
    expect(ctxSizeOf(argsFor(1))).toBe('2048')
  })

  it('補正が不要なモデルでは、補正の引数を付けない', () => {
    const args = buildLlamaServerArguments({ size: '2b', quant: 'Q4_K_M', port: 8080, parallel: 4, yarnArguments: [] })
    expect(args).not.toContain('--yarn-beta-fast')
  })

  it('不正なポート番号と同時処理数はエラーにする', () => {
    const base = { size: '2b', quant: 'Q4_K_M', yarnArguments } as const
    expect(() => buildLlamaServerArguments({ ...base, port: 0, parallel: 4 })).toThrow()
    expect(() => buildLlamaServerArguments({ ...base, port: 70000, parallel: 4 })).toThrow()
    expect(() => buildLlamaServerArguments({ ...base, port: 8080, parallel: 0 })).toThrow()
  })
})
