import { parseAllDocuments } from 'yaml'
import { detectFormat } from './index'

/** 自动检测出的候选替换规则。 */
export interface RuleCandidate {
  keyPath: string
  leftValue: string
  rightValue: string
}

export interface DetectResult {
  candidates: RuleCandidate[]
  warnings: string[]
}

type JS = unknown

function isPlainObject(v: JS): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function joinPath(path: Array<string | number>): string {
  return path.map((s) => String(s)).join('.')
}

function stringify(v: JS): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** 枚举对象值内的叶子路径（数组整体视为叶子）。 */
function leafPaths(v: JS, base: Array<string | number>, out: Array<Array<string | number>>): void {
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) leafPaths(v[k], [...base, k], out)
  } else {
    out.push(base)
  }
}

function getAt(v: JS, path: Array<string | number>): JS {
  let cur: JS = v
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      if (typeof seg !== 'number') return undefined
      cur = cur[seg]
    } else {
      cur = (cur as Record<string, unknown>)[seg as string]
    }
  }
  return cur
}

function isPrimitive(v: JS): boolean {
  return v === null || typeof v !== 'object'
}

/**
 * 深度比较左右两个 JS 值，收集"值差异"为候选规则：
 * - 叶子值不同 → 一条候选（keyPath = 点路径）
 * - 等长对象数组：若某叶子路径在全部元素上右侧值统一为 V 且左侧不全为 V
 *   → 归纳为一条通配候选 `arr.*.leaf`（与数组长度无关），不再逐下标产出
 * - 键缺失/数组长度不同等结构性差异 → 不产候选（由"自动合并"处理）
 */
function diffNodes(
  l: JS,
  r: JS,
  path: Array<string | number>,
  out: RuleCandidate[],
  covered: Set<string>
): void {
  const pathKey = joinPath(path)
  if (pathKey !== '' && covered.has(pathKey)) return

  if (Array.isArray(l) && Array.isArray(r)) {
    if (l.length !== r.length) return // 结构性差异，规则无法表达
    // 对象数组：统一变化的叶子归纳为通配候选
    if (l.length > 0 && l.every(isPlainObject) && r.every(isPlainObject)) {
      const leaves: Array<Array<string | number>> = []
      for (const el of [...l, ...r]) leafPaths(el, [], leaves)
      const uniq = [...new Map(leaves.map((p) => [joinPath(p), p])).values()]
      for (const leaf of uniq) {
        const lVals = l.map((el) => getAt(el, leaf))
        const rVals = r.map((el) => getAt(el, leaf))
        if (lVals.some((v) => v === undefined) || rVals.some((v) => v === undefined)) continue
        if (!lVals.every(isPrimitive) || !rVals.every(isPrimitive)) continue
        const v0 = rVals[0]
        if (!rVals.every((v) => v === v0)) continue // 右侧各元素不一致，无法用一条通配表达
        if (lVals.every((v) => v === v0)) continue // 左右无差异
        const leftSet = new Set(lVals.map(stringify))
        out.push({
          keyPath: joinPath([...path, '*', ...leaf]),
          leftValue: leftSet.size === 1 ? stringify(lVals[0]) : '（多个不同值）',
          rightValue: stringify(v0)
        })
        l.forEach((_, i) => covered.add(joinPath([...path, i, ...leaf])))
      }
    }
    l.forEach((el, i) => diffNodes(el, r[i], [...path, i], out, covered))
    return
  }

  if (isPlainObject(l) && isPlainObject(r)) {
    const keys = new Set([...Object.keys(l), ...Object.keys(r)])
    for (const k of keys) {
      if (!(k in l) || !(k in r)) continue // 键缺失 = 结构性差异
      diffNodes(l[k], r[k], [...path, k], out, covered)
    }
    return
  }

  // 容器类型不一致 = 结构性差异
  if ((l !== null && typeof l === 'object') !== (r !== null && typeof r === 'object')) return
  if (Array.isArray(l) !== Array.isArray(r)) return

  if (l !== r) {
    out.push({ keyPath: pathKey, leftValue: stringify(l), rightValue: stringify(r) })
  }
}

function parseProperties(content: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('!')) continue
    const mm = t.match(/^([^=:\s]+)\s*[=:]\s*(.*)$/)
    if (mm) m.set(mm[1], mm[2].trim())
  }
  return m
}

/**
 * 自动检测替换规则入口：比较左右两侧内容，产出可保存的候选规则。
 * 结构性差异（增删行/键）不在产出范围——那部分由"自动合并"处理。
 */
export function detectRuleCandidates(
  left: string,
  right: string,
  configType: string,
  dataId: string
): DetectResult {
  if (left === right) return { candidates: [], warnings: [] }

  switch (detectFormat(configType, dataId)) {
    case 'yaml': {
      const dl = parseAllDocuments(left)
      const dr = parseAllDocuments(right)
      if (dl.length > 1 || dr.length > 1) {
        return { candidates: [], warnings: ['YAML 含多个文档，无法自动检测规则'] }
      }
      if (dl[0]?.errors.length) {
        return { candidates: [], warnings: ['左侧内容 YAML 解析失败，无法自动检测规则'] }
      }
      if (dr[0]?.errors.length) {
        return { candidates: [], warnings: ['右侧内容 YAML 解析失败，无法自动检测规则'] }
      }
      const out: RuleCandidate[] = []
      diffNodes(dl[0]?.toJS() ?? null, dr[0]?.toJS() ?? null, [], out, new Set())
      return { candidates: out, warnings: [] }
    }
    case 'properties': {
      const pl = parseProperties(left)
      const pr = parseProperties(right)
      const out: RuleCandidate[] = []
      for (const [k, lv] of pl) {
        const rv = pr.get(k)
        if (rv !== undefined && rv !== lv) {
          out.push({ keyPath: k, leftValue: lv, rightValue: rv })
        }
      }
      return { candidates: out, warnings: [] }
    }
    default:
      return { candidates: [], warnings: ['无法识别配置格式，不能自动检测规则'] }
  }
}
