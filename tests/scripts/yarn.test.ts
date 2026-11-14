import { describe, expect, it } from 'vitest'
import { yarnRangeArguments } from '../../scripts/lib/yarn.ts'

// pfnet/plamo-3-translate-2b-GGUF の Q4_K_M から読み取った値(2026-11-14 に確認)。
const PLAMO3_2B = {
  'general.architecture': 'plamo3',
  'plamo3.rope.scaling.type': 'yarn',
  'plamo3.rope.scaling.factor': 256,
  'plamo3.rope.scaling.original_context_length': 4096,
  'plamo3.rope.scaling.yarn_beta_fast': 32,
  'plamo3.rope.scaling.yarn_beta_slow': 1,
  'plamo3.rope.scaling.yarn_truncate': false,
  'plamo3.rope.freq_base': 1000000,
  'plamo3.attention.key_length': 128,
}

describe('yarnRangeArguments', () => {
  it('2B の GGUF から、PFN 公式 CLI が公表している値と同じ引数を作る', () => {
    // 期待値の出典: pfnet/plamo-translate-cli の
    // benchmarks/llama_cpp_plamo3_yarn_20261105/README.md
    expect(yarnRangeArguments(PLAMO3_2B)).toEqual([
      '--yarn-beta-fast',
      '31.738495',
      '--yarn-beta-slow',
      '1.0040927',
    ])
  })

  it('数値が bigint で渡されても同じ結果になる', () => {
    expect(
      yarnRangeArguments({
        ...PLAMO3_2B,
        'plamo3.rope.scaling.original_context_length': 4096n,
        'plamo3.attention.key_length': 128n,
      }),
    ).toEqual(['--yarn-beta-fast', '31.738495', '--yarn-beta-slow', '1.0040927'])
  })

  it('rope.dimension_count があれば key_length より優先する', () => {
    const withDimensionCount = yarnRangeArguments({ ...PLAMO3_2B, 'plamo3.rope.dimension_count': 64 })
    expect(withDimensionCount).toHaveLength(4)
    expect(withDimensionCount).not.toEqual(yarnRangeArguments(PLAMO3_2B))
  })

  it('yarn_truncate が false でなければ、補正は不要なので空を返す', () => {
    expect(yarnRangeArguments({ ...PLAMO3_2B, 'plamo3.rope.scaling.yarn_truncate': true })).toEqual([])
    const { 'plamo3.rope.scaling.yarn_truncate': _omitted, ...withoutTruncate } = PLAMO3_2B
    expect(yarnRangeArguments(withoutTruncate)).toEqual([])
  })

  it('位置符号化が YaRN でなければ空を返す', () => {
    expect(yarnRangeArguments({ ...PLAMO3_2B, 'plamo3.rope.scaling.type': 'linear' })).toEqual([])
  })

  it('必要な情報が欠けていれば空を返す', () => {
    expect(yarnRangeArguments({})).toEqual([])
    const { 'plamo3.rope.freq_base': _omitted, ...withoutBase } = PLAMO3_2B
    expect(yarnRangeArguments(withoutBase)).toEqual([])
  })
})
