import type { ApplyResult, ReplacementRule } from '../types'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 对 .properties 内容应用替换规则：按行匹配 `key=` / `key:`，仅替换值部分，
 * 保留行首缩进、分隔符风格与注释行（# / !）。
 */
export function applyProperties(content: string, rules: ReplacementRule[]): ApplyResult {
  let text = content
  let changed = false
  const warnings: string[] = []

  for (const rule of rules) {
    const key = rule.keyPath.trim()
    if (!key) {
      warnings.push('存在 Key 为空的规则，已跳过')
      continue
    }
    const re = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*[=:]\\s*).*$`, 'gm')
    let matched = false
    text = text.replace(re, (_m, head: string) => {
      matched = true
      return head + rule.value
    })
    if (matched) {
      changed = true
    } else {
      warnings.push(`规则「${key}」: properties 中不存在该 key，已跳过`)
    }
  }

  return { content: text, changed, warnings }
}
