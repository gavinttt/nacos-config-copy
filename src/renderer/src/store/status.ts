import { applyRules } from '@shared/rules'
import type { ConfigItem, ConfigRowState, ConfigStatus, ReplacementRule } from '@shared/types'

export function rowKey(group: string, dataId: string): string {
  return `${group}/${dataId}`
}

/** 由源/目标命名空间的配置列表 + 目标规则构建行状态。 */
export function buildRows(
  sourceItems: ConfigItem[],
  targetItems: ConfigItem[],
  rules: ReplacementRule[]
): ConfigRowState[] {
  const targetMap = new Map(targetItems.map((t) => [rowKey(t.group, t.dataId), t]))

  return sourceItems.map((s) => {
    const key = rowKey(s.group, s.dataId)
    const target = targetMap.get(key)
    const { content: preview, warnings } = applyRules(s.content, s.type, s.dataId, rules)
    const baseline = target ? target.content : preview

    const row: ConfigRowState = {
      key,
      dataId: s.dataId,
      group: s.group,
      type: s.type,
      sourceContent: s.content,
      targetContent: target ? target.content : null,
      preview,
      previewWarnings: warnings,
      baseline,
      leftBuffer: s.content,
      rightBuffer: baseline,
      publishedContent: null,
      lastPublishError: null,
      status: 'pending'
    }
    row.status = computeRowStatus(row)
    return row
  })
}

/**
 * 行状态机：
 * 发布失败 → 已发布 → 右侧未编辑时（无差异 / 有差异；目标缺失按有差异）→ 已修改未发布
 */
export function computeRowStatus(r: ConfigRowState): ConfigStatus {
  if (r.lastPublishError) return 'error'
  if (r.publishedContent !== null && r.rightBuffer === r.publishedContent) return 'published'
  if (r.rightBuffer === r.baseline) {
    if (r.targetContent === null) return 'diff'
    return r.preview === r.targetContent ? 'same' : 'diff'
  }
  return 'edited'
}
