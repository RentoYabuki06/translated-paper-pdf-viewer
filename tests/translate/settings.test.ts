import { describe, expect, it } from 'vitest'
import { LlamaServerBackend } from '../../src/translate/llamaServer.ts'
import { OllamaBackend } from '../../src/translate/ollama.ts'
import { connectionWarnings, createBackend, DEFAULT_SETTINGS, describeTarget, normalizeSettings } from '../../src/translate/settings.ts'

describe('normalizeSettings', () => {
  it('保存された値が無ければ、既定の設定を返す', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('broken')).toEqual(DEFAULT_SETTINGS)
  })

  it('保存された設定を読む', () => {
    const stored = {
      kind: 'ollama',
      llamaServerUrl: 'http://127.0.0.1:8081',
      ollamaUrl: 'http://127.0.0.1:11435',
      ollamaModel: ' plamo-3-translate-2b ',
      ollamaParallel: 2,
    }
    expect(normalizeSettings(stored)).toEqual({ ...stored, ollamaModel: 'plamo-3-translate-2b' })
  })

  it('欠けている項目や、正しくない値は、既定の値で補う', () => {
    expect(normalizeSettings({ kind: 'other', llamaServerUrl: '  ', ollamaParallel: 100, ollamaModel: 5 })).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ ollamaParallel: 1.5 }).ollamaParallel).toBe(1)
  })

  it('設定が保存されていない場合は、以前の版が保存した llama-server の URL を使う', () => {
    expect(normalizeSettings(null, 'http://127.0.0.1:8081').llamaServerUrl).toBe('http://127.0.0.1:8081')
    // 新しい設定があれば、そちらを使う。
    expect(normalizeSettings({ llamaServerUrl: 'http://127.0.0.1:9000' }, 'http://127.0.0.1:8081').llamaServerUrl).toBe(
      'http://127.0.0.1:9000',
    )
  })
})

describe('createBackend と describeTarget', () => {
  it('種類に合わせて、依頼先を作る', () => {
    expect(createBackend(DEFAULT_SETTINGS)).toBeInstanceOf(LlamaServerBackend)
    expect(createBackend({ ...DEFAULT_SETTINGS, kind: 'ollama', ollamaModel: 'plamo' })).toBeInstanceOf(OllamaBackend)
  })

  it('依頼先を、短い文字列にする', () => {
    expect(describeTarget(DEFAULT_SETTINGS)).toBe('llama-server(http://127.0.0.1:8080)')
    expect(describeTarget({ ...DEFAULT_SETTINGS, kind: 'ollama' })).toBe('Ollama(http://127.0.0.1:11434)')
  })
})

describe('connectionWarnings', () => {
  it('npm run model で起動した llama-server には、注意を出さない', () => {
    for (const modelId of ['plamo-3-translate-2b-Q4_K_M', 'plamo-3-translate-0.8b-Q4_0', 'plamo-3-translate-31b-Q2_K']) {
      expect(connectionWarnings('llama-server', { modelId, slots: 4, contextPerSlot: 2048 }), modelId).toEqual([])
    }
  })

  it('以前の版の npm run model で起動した llama-server には、起動し直すよう注意を出す', () => {
    const warnings = connectionWarnings('llama-server', { modelId: 'plamo-3-translate', slots: 4, contextPerSlot: 2048 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('起動し直してください')
  })

  it('モデルの名前に plamo が含まれない場合は、注意を出す', () => {
    const warnings = connectionWarnings('ollama', { modelId: 'llama3.1:8b', slots: 1, contextPerSlot: 2048 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('llama3.1:8b')
  })

  it('llama-server のモデルの別名が、起動用のコマンドのものと違う場合は、注意を出す', () => {
    // 別名を付けずに起動した llama-server は、モデルの取得元の指定や、ファイルの名前を知らせる。
    for (const modelId of ['pfnet/plamo-3-translate-2b-GGUF:Q4_K_M', 'plamo-3-translate-2b-Q4_K_M.gguf']) {
      const warnings = connectionWarnings('llama-server', { modelId, slots: 1, contextPerSlot: 4096 })
      expect(warnings, modelId).toHaveLength(1)
      expect(warnings[0], modelId).toContain('npm run model 以外の方法')
    }
    // Ollama では、モデルの名前は利用者が付けるので、別名は確かめない。
    expect(connectionWarnings('ollama', { modelId: 'plamo-3-translate-2b', slots: 1, contextPerSlot: 2048 })).toEqual([])
  })

  it('1 件の依頼で使える長さが短い場合は、注意を出す', () => {
    const warnings = connectionWarnings('llama-server', { modelId: 'plamo-3-translate-2b-Q4_K_M', slots: 8, contextPerSlot: 1024 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('1024')
    // 長さが分からない場合は、注意を出さない。
    expect(connectionWarnings('llama-server', { modelId: 'plamo-3-translate-2b-Q4_K_M', slots: 4, contextPerSlot: null })).toEqual([])
  })
})
