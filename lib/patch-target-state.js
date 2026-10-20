/**
 * 当前正在清洗的 aiBase（补丁目标宿主）。
 *
 * 为什么单独一个模块：这个值在两处被写、在三处被读，而且读写分属不同的
 * 职责块（打补丁的主流程写它，闪窗抑制与版本判定的辅助函数读它）。
 * 把它挂在 core.js 里再用 import 传出去，会让"谁可以改"变得含糊；
 * 收进这里之后，写入只有 setPatchTargetAiBase 一个入口，读只有一个 getter。
 *
 * 语义与拆分前完全一致：默认 null，设为 null/空 即"没有特定目标"，
 * 读取方据此回退到 findAiBase() 之类的默认判定。
 */

let target = null

/** @returns {string|null} 当前补丁目标宿主根；未设置时为 null。 */
export function getPatchTargetAiBase() {
  return target
}

/** @param {string|null|undefined} value 新的目标根；null/空等价于清除。 */
export function setPatchTargetAiBase(value) {
  target = value || null
}
