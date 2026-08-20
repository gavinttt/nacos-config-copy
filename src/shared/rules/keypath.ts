/**
 * 解析 key 路径，如 "login.baseUrl" → ['login', 'baseUrl']，"hosts.0.url" → ['hosts', 0, 'url']。
 * 纯数字段解析为数组下标；空段/空路径抛出中文错误。
 */
export function parseKeyPath(keyPath: string): Array<string | number> {
  const trimmed = keyPath.trim()
  if (!trimmed) throw new Error('非法的 Key 路径: 不能为空')
  const out: Array<string | number> = []
  for (const raw of trimmed.split('.')) {
    const seg = raw.trim()
    if (seg === '') throw new Error(`非法的 Key 路径: 「${keyPath}」`)
    out.push(/^\d+$/.test(seg) ? Number(seg) : seg)
  }
  return out
}
