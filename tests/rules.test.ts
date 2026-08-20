import { describe, expect, it } from 'vitest'
import { applyRules, detectFormat, monacoLanguage, ruleMatchesDataId } from '../src/shared/rules'
import { detectRuleCandidates } from '../src/shared/rules/detect'
import { parseKeyPath } from '../src/shared/rules/keypath'
import type { ReplacementRule } from '../src/shared/types'

const rule = (
  keyPath: string,
  value: string,
  enabled = true,
  dataId?: string
): ReplacementRule => ({
  id: keyPath + (dataId ?? ''),
  keyPath,
  value,
  enabled,
  dataId
})

describe('parseKeyPath', () => {
  it('解析普通嵌套路径', () => {
    expect(parseKeyPath('login.baseUrl')).toEqual(['login', 'baseUrl'])
  })
  it('数字段解析为数组下标', () => {
    expect(parseKeyPath('hosts.0.url')).toEqual(['hosts', 0, 'url'])
  })
  it('空路径与空段报错', () => {
    expect(() => parseKeyPath('')).toThrow()
    expect(() => parseKeyPath('a..b')).toThrow()
  })
})

describe('detectFormat', () => {
  it('type 优先', () => {
    expect(detectFormat('yaml', 'x')).toBe('yaml')
    expect(detectFormat('properties', 'x')).toBe('properties')
    expect(detectFormat('json', 'x')).toBe('yaml') // json 走 yaml 引擎
  })
  it('type 不可靠时按 dataId 扩展名兜底（实测存在 yaml 被标为 text）', () => {
    expect(detectFormat('text', 'service-config.yaml')).toBe('yaml')
    expect(detectFormat('text', 'app.properties')).toBe('properties')
    expect(detectFormat('', 'a/b/redis.yml')).toBe('yaml')
  })
  it('无法识别返回 unknown', () => {
    expect(detectFormat('xml', 'x.xml')).toBe('unknown')
    expect(detectFormat('text', 'readme')).toBe('unknown')
  })
  it('monaco 语言映射', () => {
    expect(monacoLanguage('yaml', 'x.yaml')).toBe('yaml')
    expect(monacoLanguage('json', 'x.json')).toBe('json')
    expect(monacoLanguage('properties', 'x.properties')).toBe('ini')
    expect(monacoLanguage('text', 'readme')).toBe('plaintext')
  })
})

describe('yaml 规则应用', () => {
  const SRC = [
    '# 服务配置',
    'login:',
    '  baseUrl: http://127.0.0.1:3300 # 服务外部地址（客户端接口）',
    '  secretKey: example-secret # API签名密钥',
    '',
    'protoLogEnabled: true',
    ''
  ].join('\n')

  it('替换嵌套路径的值并逐字节保留注释与其他内容', () => {
    const r = applyRules(SRC, 'yaml', 'service-config.yaml', [
      rule('login.baseUrl', 'http://svc.internal:3300')
    ])
    expect(r.changed).toBe(true)
    expect(r.content).toBe(
      [
        '# 服务配置',
        'login:',
        '  baseUrl: http://svc.internal:3300 # 服务外部地址（客户端接口）',
        '  secretKey: example-secret # API签名密钥',
        '',
        'protoLogEnabled: true',
        ''
      ].join('\n')
    )
    expect(r.warnings).toEqual([])
  })

  it('幂等：应用两次结果一致', () => {
    const once = applyRules(SRC, 'yaml', 'a.yaml', [rule('login.baseUrl', 'http://x:1')])
    const twice = applyRules(once.content, 'yaml', 'a.yaml', [rule('login.baseUrl', 'http://x:1')])
    expect(twice.content).toBe(once.content)
    expect(twice.changed).toBe(true) // setIn 仍会写值，但输出稳定
  })

  it('路径不存在 → 原样 + 警告', () => {
    const r = applyRules(SRC, 'yaml', 'a.yaml', [rule('not.exist', 'v')])
    expect(r.changed).toBe(false)
    expect(r.content).toBe(SRC)
    expect(r.warnings[0]).toContain('不存在该路径')
  })

  it('路径指向对象整体 → 跳过 + 警告', () => {
    const r = applyRules(SRC, 'yaml', 'a.yaml', [rule('login', 'v')])
    expect(r.changed).toBe(false)
    expect(r.warnings[0]).toContain('对象/数组')
  })

  it('数组下标路径', () => {
    const src = 'servers:\n  - url: http://a\n  - url: http://b\n'
    const r = applyRules(src, 'yaml', 'a.yaml', [rule('servers.1.url', 'http://c')])
    expect(r.changed).toBe(true)
    expect(r.content).toContain('http://a')
    expect(r.content).toContain('http://c')
    expect(r.content).not.toContain('http://b')
  })

  it('数组下标越界 → 警告', () => {
    const src = 'servers:\n  - url: http://a\n'
    const r = applyRules(src, 'yaml', 'a.yaml', [rule('servers.5.url', 'http://c')])
    expect(r.changed).toBe(false)
    expect(r.warnings.length).toBe(1)
  })

  it('块标量被替换为普通标量', () => {
    const src = 'desc: |\n  line1\n  line2\n'
    const r = applyRules(src, 'yaml', 'a.yaml', [rule('desc', 'new')])
    expect(r.changed).toBe(true)
    expect(r.content).toBe('desc: new\n')
  })

  it('无规则变更时不做 toString，避免虚假 diff', () => {
    const src = 'a: 1   # 注释\n'
    const r = applyRules(src, 'yaml', 'a.yaml', [rule('no.such', 'v')])
    expect(r.content).toBe(src)
  })

  it('解析失败 → 原样 + 警告', () => {
    const src = 'a: [1, 2\n'
    const r = applyRules(src, 'yaml', 'a.yaml', [rule('a', 'v')])
    expect(r.changed).toBe(false)
    expect(r.content).toBe(src)
    expect(r.warnings[0]).toContain('YAML 解析失败')
  })

  it('多文档 YAML → 原样 + 警告', () => {
    const src = 'a: 1\n---\nb: 2\n'
    const r = applyRules(src, 'yaml', 'a.yaml', [rule('a', 'v')])
    expect(r.changed).toBe(false)
    expect(r.warnings[0]).toContain('多个文档')
  })

  it('json 内容（YAML 1.2 超集）', () => {
    const src = '{"a": {"b": 1}}'
    const r = applyRules(src, 'json', 'a.json', [rule('a.b', '2')])
    expect(r.changed).toBe(true)
    expect(r.content).toContain('"b"')
    expect(r.content).toContain('2')
  })

  it('禁用与空 keyPath 的规则被忽略', () => {
    const r = applyRules(SRC, 'yaml', 'a.yaml', [
      rule('login.baseUrl', 'x', false),
      rule('', 'y')
    ])
    expect(r.changed).toBe(false)
    expect(r.content).toBe(SRC)
  })
})

describe('properties 规则应用', () => {
  const SRC = ['# 数据库', 'db.url=jdbc:mysql://127.0.0.1:3306/x', 'db.user = root', 'other: keep', ''].join(
    '\n'
  )

  it('替换 = 与 : 分隔的值，保留注释与其余行', () => {
    const r = applyRules(SRC, 'properties', 'db.properties', [
      rule('db.url', 'jdbc:mysql://mysql:3306/x'),
      rule('db.user', 'admin')
    ])
    expect(r.changed).toBe(true)
    expect(r.content).toBe(
      ['# 数据库', 'db.url=jdbc:mysql://mysql:3306/x', 'db.user = admin', 'other: keep', ''].join('\n')
    )
  })

  it('key 不存在 → 警告', () => {
    const r = applyRules(SRC, 'properties', 'db.properties', [rule('no.key', 'v')])
    expect(r.changed).toBe(false)
    expect(r.warnings[0]).toContain('不存在该 key')
  })

  it('不会误匹配前缀相同的 key', () => {
    const r = applyRules('db.urls=1\n', 'properties', 'a.properties', [rule('db.url', '2')])
    expect(r.changed).toBe(false)
    expect(r.content).toBe('db.urls=1\n')
  })
})

describe('自动检测替换规则', () => {
  const LEFT = [
    'redis:',
    '  - type: server',
    '    host: localhost',
    '    port: 6388',
    '  - type: game',
    '    host: localhost',
    '    port: 6388',
    'login:',
    '  baseUrl: http://127.0.0.1:3300',
    ''
  ].join('\n')

  it('统一变化的数组叶子归纳为通配候选 + 普通叶子候选', () => {
    const right = LEFT.replaceAll('host: localhost', 'host: cache.internal').replaceAll(
      'port: 6388',
      'port: 6379'
    ).replace('baseUrl: http://127.0.0.1:3300', 'baseUrl: http://svc.internal:3300')
    const r = detectRuleCandidates(LEFT, right, 'yaml', 'redis.yaml')
    expect(r.warnings).toEqual([])
    const paths = r.candidates.map((c) => c.keyPath).sort()
    expect(paths).toEqual(['login.baseUrl', 'redis.*.host', 'redis.*.port'])
    const host = r.candidates.find((c) => c.keyPath === 'redis.*.host')!
    expect(host.leftValue).toBe('localhost')
    expect(host.rightValue).toBe('cache.internal')
  })

  it('右侧各元素不一致 → 逐下标候选', () => {
    const right = LEFT.replace('  - type: server\n    host: localhost', '  - type: server\n    host: h0').replace(
      '  - type: game\n    host: localhost',
      '  - type: game\n    host: h1'
    )
    const r = detectRuleCandidates(LEFT, right, 'yaml', 'x.yaml')
    const paths = r.candidates.map((c) => c.keyPath).sort()
    expect(paths).toEqual(['redis.0.host', 'redis.1.host'])
  })

  it('左右相同 → 无候选', () => {
    const r = detectRuleCandidates(LEFT, LEFT, 'yaml', 'x.yaml')
    expect(r.candidates).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('数组长度不同（结构性差异）→ 不产候选', () => {
    const right = LEFT.replace('  - type: game\n    host: localhost\n    port: 6388\n', '')
    const r = detectRuleCandidates(LEFT, right, 'yaml', 'x.yaml')
    expect(r.candidates.filter((c) => c.keyPath.startsWith('redis'))).toEqual([])
  })

  it('检测出的规则可直接应用回左侧得到右侧（闭环）', () => {
    const right = LEFT.replaceAll('host: localhost', 'host: h2')
    const { candidates } = detectRuleCandidates(LEFT, right, 'yaml', 'x.yaml')
    const rules: ReplacementRule[] = candidates.map((c, i) => ({
      id: String(i),
      keyPath: c.keyPath,
      value: c.rightValue,
      enabled: true
    }))
    const applied = applyRules(LEFT, 'yaml', 'x.yaml', rules)
    expect(applied.content).toBe(right)
  })

  it('properties 差异检测', () => {
    const r = detectRuleCandidates('a=1\nb=2\n', 'a=1\nb=3\n', 'properties', 'x.properties')
    expect(r.candidates).toEqual([{ keyPath: 'b', leftValue: '2', rightValue: '3' }])
  })

  it('右侧解析失败 → 警告', () => {
    const r = detectRuleCandidates(LEFT, 'a: [1, 2\n', 'yaml', 'x.yaml')
    expect(r.candidates).toEqual([])
    expect(r.warnings[0]).toContain('解析失败')
  })
})

describe('通配符路径（数组/对象全部元素）', () => {
  const SRC = [
    'redis:',
    '  - type: server',
    '    host: localhost',
    '    password: a',
    '    port: 6388',
    '  - type: game',
    '    host: localhost',
    '    password: a',
    '    port: 6388',
    ''
  ].join('\n')

  it('redis.*.host 替换数组全部元素的 host', () => {
    const r = applyRules(SRC, 'yaml', 'redis.yaml', [
      rule('redis.*.host', 'cache.internal')
    ])
    expect(r.changed).toBe(true)
    expect(r.content.match(/host: cache\.internal/g)).toHaveLength(2)
    expect(r.content).not.toContain('host: localhost')
    expect(r.content).toContain('type: server') // 其余内容保留
  })

  it('多条规则同时替换 host/password/port', () => {
    const r = applyRules(SRC, 'yaml', 'redis.yaml', [
      rule('redis.*.host', 'cache.internal'),
      rule('redis.*.password', 'new-pass'),
      rule('redis.*.port', '6379')
    ])
    expect(r.content.match(/host: cache\.internal/g)).toHaveLength(2)
    expect(r.content.match(/password: new-pass/g)).toHaveLength(2)
    expect(r.content.match(/port: 6379/g)).toHaveLength(2)
    expect(r.warnings).toEqual([])
  })

  it('与数组长度无关：第 3 个元素同样生效', () => {
    const src3 = SRC.replace(
      '  - type: game',
      '  - type: lobby\n    host: localhost\n    password: a\n    port: 6388\n  - type: game'
    )
    const r = applyRules(src3, 'yaml', 'redis.yaml', [
      rule('redis.*.host', 'h2')
    ])
    expect(r.content.match(/host: h2/g)).toHaveLength(3)
  })

  it('通配符无匹配 → 警告且原样', () => {
    const r = applyRules(SRC, 'yaml', 'redis.yaml', [rule('mysql.*.host', 'x')])
    expect(r.changed).toBe(false)
    expect(r.content).toBe(SRC)
    expect(r.warnings[0]).toContain('不存在该路径')
  })

  it('* 在对象上 = 全部值', () => {
    const src = 'servers:\n  a:\n    host: h1\n  b:\n    host: h2\n'
    const r = applyRules(src, 'yaml', 's.yaml', [rule('servers.*.host', 'h3')])
    expect(r.content.match(/host: h3/g)).toHaveLength(2)
  })

  it('通配符与下标可混用', () => {
    const r = applyRules(SRC, 'yaml', 'redis.yaml', [rule('redis.1.host', 'only-game')])
    expect(r.content).toContain('host: localhost') // 第 0 个未动
    expect(r.content).toContain('host: only-game')
  })
})

describe('未知格式', () => {
  it('内容原样 + 警告', () => {
    const r = applyRules('<xml/>', 'xml', 'a.xml', [rule('a', 'v')])
    expect(r.changed).toBe(false)
    expect(r.content).toBe('<xml/>')
    expect(r.warnings[0]).toContain('无法识别配置格式')
  })
})

describe('按 DataId 限定规则生效范围', () => {
  const SRC = 'login:\n  baseUrl: http://127.0.0.1:3300\ndb:\n  host: 127.0.0.1\n'

  it('ruleMatchesDataId：留空匹配所有、精确匹配、通配符匹配', () => {
    expect(ruleMatchesDataId(rule('a', 'b', true, ''), 'x.yaml')).toBe(true)
    expect(ruleMatchesDataId(rule('a', 'b', true, undefined), 'x.yaml')).toBe(true)
    expect(ruleMatchesDataId(rule('a', 'b', true, 'service-config.yaml'), 'service-config.yaml')).toBe(true)
    expect(ruleMatchesDataId(rule('a', 'b', true, 'service-config.yaml'), 'redis.yaml')).toBe(false)
    expect(ruleMatchesDataId(rule('a', 'b', true, '*-application.yaml'), 'web-application.yaml')).toBe(true)
    expect(ruleMatchesDataId(rule('a', 'b', true, '*-application.yaml'), 'service-config.yaml')).toBe(false)
    expect(ruleMatchesDataId(rule('a', 'b', true, 'config-*.yaml'), 'config-a.yaml')).toBe(true)
    // * 不应跨越 . 之外的正则语义
    expect(ruleMatchesDataId(rule('a', 'b', true, 'a.*'), 'a.yaml')).toBe(true)
    expect(ruleMatchesDataId(rule('a', 'b', true, 'a.*'), 'aXyaml')).toBe(false)
  })

  it('DataId 匹配 → 规则生效', () => {
    const r = applyRules(SRC, 'yaml', 'service-config.yaml', [
      rule('login.baseUrl', 'http://svc.internal:3300', true, 'service-config.yaml')
    ])
    expect(r.changed).toBe(true)
    expect(r.content).toContain('http://svc.internal:3300')
  })

  it('DataId 不匹配 → 静默跳过，无警告', () => {
    const r = applyRules(SRC, 'yaml', 'redis.yaml', [
      rule('login.baseUrl', 'http://svc.internal:3300', true, 'service-config.yaml')
    ])
    expect(r.changed).toBe(false)
    expect(r.content).toBe(SRC)
    expect(r.warnings).toEqual([])
  })

  it('通配符按文件名分别生效', () => {
    const rules = [
      rule('login.baseUrl', 'http://k8s:3300', true, 'service-*.yaml'),
      rule('db.host', 'mysql', true, 'db.yaml')
    ]
    const a = applyRules(SRC, 'yaml', 'service-config.yaml', rules)
    expect(a.content).toContain('http://k8s:3300')
    expect(a.content).toContain('host: 127.0.0.1') // db 规则不适用本文件

    const b = applyRules(SRC, 'yaml', 'db.yaml', rules)
    expect(b.content).toContain('host: mysql')
    expect(b.content).toContain('http://127.0.0.1:3300') // login 规则不适用本文件
  })

  it('旧规则无 dataId 字段 → 对所有配置生效（向后兼容）', () => {
    const legacy: ReplacementRule = { id: 'x', keyPath: 'db.host', value: 'mysql', enabled: true }
    const r = applyRules(SRC, 'yaml', 'whatever.yaml', [legacy])
    expect(r.changed).toBe(true)
    expect(r.content).toContain('host: mysql')
  })
})
