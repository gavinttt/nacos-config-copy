import {
  Scalar,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  type Node as YamlNode
} from 'yaml'
import type { ApplyResult, ReplacementRule } from '../types'
import { parseKeyPath } from './keypath'

/**
 * 新值继承原节点的类型：原值是数字且新值可解析为数字 → 写数字（不加引号）；
 * 原值是布尔 → 写布尔；否则按字符串写入（必要时 yaml 自动加引号）。
 */
function coerceToOriginalType(raw: string, original: unknown): string | number | boolean {
  const t = raw.trim()
  if (typeof original === 'number' && /^-?\d+(?:\.\d+)?$/.test(t)) return Number(t)
  if (typeof original === 'boolean' && (t === 'true' || t === 'false')) return t === 'true'
  return raw
}

/**
 * 沿路径解析出所有匹配的节点。
 * 支持 `*` 通配段：数组上的 `*` = 全部元素，对象上的 `*` = 全部值
 * （如 redis.*.host = 数组中每个元素的 host）。
 */
function resolvePath(node: YamlNode | undefined, segs: Array<string | number>): YamlNode[] {
  if (node === undefined) return []
  if (segs.length === 0) return [node]
  const [head, ...rest] = segs

  if (head === '*') {
    let children: YamlNode[] = []
    if (isSeq(node)) {
      children = node.items.slice() as YamlNode[]
    } else if (isMap(node)) {
      children = node.items
        .map((p) => p.value as YamlNode)
        .filter((v) => v !== undefined && v !== null)
    } else {
      return []
    }
    return children.flatMap((c) => resolvePath(c, rest))
  }

  if (isMap(node)) {
    const child = node.get(String(head), true) as YamlNode | undefined
    return resolvePath(child, rest)
  }
  if (isSeq(node) && typeof head === 'number' && head >= 0 && head < node.items.length) {
    const child = node.get(head, true) as YamlNode | undefined
    return resolvePath(child, rest)
  }
  return []
}

/**
 * 对 YAML/JSON 内容应用替换规则。
 * 使用 yaml 库的 Document AST：直接改写标量节点的值，保留注释、缩进与引号风格。
 * - 路径不存在 → 跳过 + 警告（不自动创建 key）
 * - 路径指向对象/数组整体 → 跳过 + 警告
 * - 解析失败 / 多文档 → 原样保留 + 警告
 */
export function applyYaml(content: string, rules: ReplacementRule[]): ApplyResult {
  const docs = parseAllDocuments(content)
  if (docs.length > 1) {
    return {
      content,
      changed: false,
      warnings: ['YAML 含多个文档（以 --- 分隔），替换规则未应用，内容保持原样']
    }
  }
  const doc = docs[0]
  if (!doc || doc.errors.length > 0) {
    const msg = doc?.errors[0]?.message ?? '未知解析错误'
    return {
      content,
      changed: false,
      warnings: [`YAML 解析失败（${msg}），替换规则未应用，内容保持原样`]
    }
  }

  let changed = false
  const warnings: string[] = []

  for (const rule of rules) {
    let path: Array<string | number>
    try {
      path = parseKeyPath(rule.keyPath)
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e))
      continue
    }

    let nodes: YamlNode[]
    try {
      nodes = resolvePath(doc.contents as YamlNode | undefined, path)
    } catch {
      warnings.push(`规则「${rule.keyPath}」: 路径无效，已跳过`)
      continue
    }

    if (nodes.length === 0) {
      warnings.push(`规则「${rule.keyPath}」: 配置中不存在该路径，已跳过`)
      continue
    }

    let matchedScalar = false
    let hitCollection = false
    for (const node of nodes) {
      if (isScalar(node)) {
        // 就地改写标量值（继承原类型），保留节点上挂载的注释
        node.value = coerceToOriginalType(rule.value, node.value)
        if (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED) {
          // 块标量替换后不再保留 | / > 块样式
          node.type = Scalar.PLAIN
        }
        matchedScalar = true
      } else {
        hitCollection = true
      }
    }
    if (hitCollection) {
      warnings.push(`规则「${rule.keyPath}」: 该路径指向对象/数组整体，不能用单个值替换，已跳过`)
    }
    if (matchedScalar) changed = true
  }

  return { content: changed ? doc.toString() : content, changed, warnings }
}
