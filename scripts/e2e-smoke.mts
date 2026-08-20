/**
 * 无界面冒烟测试：直接调用主进程模块，验证
 * 登录 / 命名空间列表 / 配置列表 / 规则应用 / 发布 / 读回校验。
 * 使用临时命名空间 cc-scratch，测试结束自动删除。
 *
 * 运行：
 *   npx tsx scripts/e2e-smoke.mts                          # 本地 2.x（http://localhost:8848）
 *   npx tsx scripts/e2e-smoke.mts http://localhost:8849 v3 [password] # 3.x
 */
import { NacosClient } from '../src/main/nacos-client'
import { applyRules } from '../src/shared/rules'
import type { NacosSettings } from '../src/shared/types'

const BASE = process.argv[2] ?? 'http://localhost:8848'
const VERSION: 'v2' | 'v3' = process.argv[3] === 'v3' ? 'v3' : 'v2'
const settings: NacosSettings = {
  serverUrl: BASE,
  username: 'nacos',
  password: process.argv[4] ?? 'nacos',
  apiVersion: VERSION
}
// Nacos 删除命名空间不清理配置，同名重建会复活旧配置，因此每次运行用唯一 ID
const SCRATCH = `cc-smoke-${Date.now() % 1000000}`

let token = ''

async function login(): Promise<void> {
  let res = await fetch(`${BASE}/nacos/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: settings.username, password: settings.password })
  })
  if (res.status === 404) {
    res = await fetch(`${BASE}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: settings.username, password: settings.password })
    })
  }
  token = (await res.json()).accessToken
}

async function createScratch(): Promise<void> {
  const paths =
    VERSION === 'v3'
      ? ['/nacos/v3/admin/core/namespace', '/v3/console/core/namespace']
      : ['/nacos/v1/console/namespaces']
  for (const path of paths) {
    const res = await fetch(`${BASE}${path}?accessToken=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        customNamespaceId: SCRATCH,
        namespaceId: SCRATCH,
        namespaceName: SCRATCH,
        namespaceDesc: 'nacos-config-copy 冒烟测试临时空间'
      })
    })
    const text = (await res.text()).slice(0, 80)
    console.log('create scratch:', path, res.status, text)
    if (res.status !== 404) return
  }
}

async function deleteScratch(): Promise<void> {
  const paths =
    VERSION === 'v3'
      ? ['/nacos/v3/admin/core/namespace', '/v3/console/core/namespace']
      : ['/nacos/v1/console/namespaces']
  for (const path of paths) {
    const res = await fetch(
      `${BASE}${path}?namespaceId=${SCRATCH}&accessToken=${encodeURIComponent(token)}`,
      { method: 'DELETE' }
    )
    const text = (await res.text()).slice(0, 80)
    console.log('delete scratch:', path, res.status, text)
    if (res.status !== 404) return
  }
}

async function main(): Promise<void> {
  console.log(`=== smoke: ${BASE} (${VERSION}) ===`)
  await login()
  await createScratch()

  const client = new NacosClient(() => settings)

  // 1. 命名空间列表
  const ns = await client.listNamespaces()
  console.log('namespaces:', ns.map((n) => n.namespaceShowName).join(', '))
  if (!ns.some((n) => n.namespace === SCRATCH)) throw new Error('未找到 cc-scratch')

  // 2. 源命名空间配置列表（3.x 新实例没有业务配置，先往 scratch 里发一条再读回）
  const sample = [
    '# 服务配置',
    'login:',
    '  baseUrl: http://127.0.0.1:3300 # 服务外部地址',
    'redis:',
    '  - type: server',
    '    host: localhost',
    '    port: 6388',
    ''
  ].join('\n')

  // 3. 规则应用
  const { content, changed, warnings } = applyRules(sample, 'yaml', 'service-config.yaml', [
    { id: '1', keyPath: 'login.baseUrl', value: 'http://svc.internal:3300', enabled: true },
    { id: '2', keyPath: 'redis.*.host', value: 'cache.internal', enabled: true },
    { id: '3', keyPath: 'redis.*.port', value: '6379', enabled: true }
  ])
  console.log('rules applied:', changed, 'warnings:', warnings)
  if (!content.includes('http://svc.internal:3300')) throw new Error('规则未生效')
  if (!content.includes('# 服务外部地址')) throw new Error('注释未保留')
  if (!content.includes('host: cache.internal')) throw new Error('通配规则未生效')

  // 4. 发布到 scratch
  await client.publishConfig({
    tenant: SCRATCH,
    dataId: 'service-config.yaml',
    group: 'DEFAULT_GROUP',
    content,
    type: 'yaml'
  })
  console.log('published to scratch')

  // 5. 读回校验
  const readBack = await client.listConfigs(SCRATCH)
  const item = readBack.find(
    (c) => c.dataId === 'service-config.yaml' && c.group === 'DEFAULT_GROUP'
  )
  if (!item) throw new Error('scratch 中未读到已发布配置')
  if (item.content !== content) {
    console.log('SENT:', JSON.stringify(content))
    console.log('BACK:', JSON.stringify(item.content))
    throw new Error('读回内容与发布内容不一致')
  }
  console.log('read-back verified: 内容一致')

  // 6. 错误密码应报中文错误
  const badClient = new NacosClient(() => ({ ...settings, password: 'wrong-pass' }))
  try {
    await badClient.listNamespaces()
    throw new Error('错误密码竟然成功了？')
  } catch (e) {
    console.log('错误密码预期报错:', e instanceof Error ? e.message : e)
  }

  await deleteScratch()
  console.log('\nE2E SMOKE PASSED', `(${VERSION})`)
}

main().catch((e) => {
  console.error('E2E SMOKE FAILED:', e)
  void deleteScratch().finally(() => process.exit(1))
})
