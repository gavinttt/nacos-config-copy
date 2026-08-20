import type { ApplyResult, ReplacementRule } from '../types'
import { applyProperties } from './properties-apply'
import { applyYaml } from './yaml-apply'

export type RuleFormat = 'yaml' | 'properties' | 'unknown'

/**
 * 判定配置格式。type 字段优先，但 Nacos 中 type 并不总可靠
 * （实测存在 yaml 内容被标记为 text），因此 type 无法确定时按 dataId 扩展名兜底。
 */
export function detectFormat(configType: string | undefined | null, dataId: string): RuleFormat {
  const t = (configType ?? '').trim().toLowerCase()
  if (t === 'yaml' || t === 'yml' || t === 'json') return 'yaml'
  if (t === 'properties') return 'properties'

  const ext = dataId.toLowerCase().split('.').pop() ?? ''
  if (ext === 'yaml' || ext === 'yml' || ext === 'json') return 'yaml'
  if (ext === 'properties' || ext === 'prop') return 'properties'
  return 'unknown'
}

/** Monaco 编辑器语言（用于 diff 视图语法高亮）。 */
export function monacoLanguage(configType: string | undefined | null, dataId: string): string {
  const t = (configType ?? '').trim().toLowerCase()
  const ext = dataId.toLowerCase().split('.').pop() ?? ''
  if (t === 'json' || ext === 'json') return 'json'
  if (detectFormat(configType, dataId) === 'yaml') return 'yaml'
  if (detectFormat(configType, dataId) === 'properties') return 'ini'
  return 'plaintext'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 规则是否适用于给定 DataId：
 * - dataId 留空 → 适用于所有配置
 * - 含 * → 通配符匹配（如 *-application.yaml）
 * - 否则精确匹配文件名
 */
export function ruleMatchesDataId(rule: ReplacementRule, dataId: string): boolean {
  const pattern = (rule.dataId ?? '').trim()
  if (pattern === '') return true
  if (pattern.includes('*')) {
    const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)
    return re.test(dataId)
  }
  return pattern === dataId
}

/**
 * 规则引擎入口：把 enabled、keyPath 非空且适用于该 DataId 的规则应用到配置内容。
 * 无法识别的格式：内容原样保留并给出警告。
 */
export function applyRules(
  content: string,
  configType: string | undefined | null,
  dataId: string,
  rules: ReplacementRule[]
): ApplyResult {
  const enabled = rules.filter(
    (r) => r.enabled && r.keyPath.trim().length > 0 && ruleMatchesDataId(r, dataId)
  )
  if (enabled.length === 0) return { content, changed: false, warnings: [] }

  switch (detectFormat(configType, dataId)) {
    case 'yaml':
      return applyYaml(content, enabled)
    case 'properties':
      return applyProperties(content, enabled)
    default:
      return {
        content,
        changed: false,
        warnings: [
          `无法识别配置格式（type=${configType || '空'}, dataId=${dataId}），替换规则未应用，内容保持原样`
        ]
      }
  }
}
