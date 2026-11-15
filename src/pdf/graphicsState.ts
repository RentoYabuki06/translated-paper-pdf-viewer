/**
 * 描画命令の並びを順に読みながら、その時点の座標の変換(CTM)を追う。
 *
 * PDF.js の描画命令は、変換の保存と復元、変換の追加を、いくつかの命令で行う。
 * ここでは、PDF.js の描画処理(canvas への描画)と同じ規則で、変換だけを再現する。
 */

import { OPS } from 'pdfjs-dist'
import { IDENTITY, multiply, toMatrix } from './matrix.ts'
import type { Matrix } from './matrix.ts'

/** 状態を保存する命令。対応する復元の命令まで、変換の変更が閉じ込められる。 */
const SAVE_OPS: ReadonlySet<number> = new Set([
  OPS.save,
  OPS.paintFormXObjectBegin,
  OPS.beginGroup,
  OPS.beginAnnotation,
])

/** 状態を復元する命令。 */
const RESTORE_OPS: ReadonlySet<number> = new Set([
  OPS.restore,
  OPS.paintFormXObjectEnd,
  OPS.endGroup,
  OPS.endAnnotation,
])

export function isSaveOp(fn: number): boolean {
  return SAVE_OPS.has(fn)
}

export function isRestoreOp(fn: number): boolean {
  return RESTORE_OPS.has(fn)
}

export class MatrixTracker {
  /** その時点の変換。PDF のページの座標(左下が原点)への変換。 */
  ctm: Matrix = IDENTITY
  private readonly stack: Matrix[] = []

  /** 描画命令を 1 つ読み、変換を更新する。変換に関係しない命令は無視する。 */
  handle(fn: number, args: unknown): void {
    if (SAVE_OPS.has(fn)) {
      this.stack.push(this.ctm)
      const list = (args ?? []) as ArrayLike<unknown>
      if (fn === OPS.paintFormXObjectBegin) {
        const matrix = toMatrix(list[0])
        if (matrix) this.ctm = multiply(this.ctm, matrix)
      } else if (fn === OPS.beginAnnotation) {
        // 注釈は、ページの変換からやり直して、注釈自身の 2 つの変換を重ねる。
        this.ctm = IDENTITY
        for (const index of [2, 3]) {
          const matrix = toMatrix(list[index])
          if (matrix) this.ctm = multiply(this.ctm, matrix)
        }
      }
      return
    }
    if (RESTORE_OPS.has(fn)) {
      this.ctm = this.stack.pop() ?? this.ctm
      return
    }
    if (fn === OPS.transform) {
      const matrix = toMatrix(args)
      if (matrix) this.ctm = multiply(this.ctm, matrix)
    }
  }
}
