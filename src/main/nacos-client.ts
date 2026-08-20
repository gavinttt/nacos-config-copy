import type {
  ConfigItem,
  NacosSettings,
  NamespaceInfo,
  PublishRequest
} from '@shared/types'

/** 鉴权失败专用错误：外层捕获后强制重新登录并重试一次。 */
class AuthError extends Error {}

function errMsg(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return '连接超时'
    return e.message
  }
  return String(e)
}

/** 403 常见原因：非管理员账号未绑定角色/权限。 */
const PERMISSION_HINT =
  '账号密码正确但仍 403 时：该账号没有相应权限。' +
  '方案一：在 Nacos 控制台「权限控制」为账号绑定 ROLE_ADMIN 角色，服务地址填 API 端口（默认 8848）；' +
  '方案二（最小权限）：为账号角色按命名空间授权（资源如 命名空间ID:*，动作 rw），服务地址填 console 端口（3.x 默认 8080）'

/** v1 响应用 code=200 表示成功，v2/v3 响应用 code=0 表示成功，这里兼容两者。 */
function isSuccessCode(code: unknown): boolean {
  return code === undefined || code === 0 || code === 200
}

/** 404 时提示版本选择错误（v1 接口在 3.x 被移除，v3 接口在 2.x 不存在）。 */
function versionHint(version: string): string {
  return version === 'v3'
    ? '（该服务端没有 v3 接口，可能为 2.x，请在连接设置中切换版本）'
    : '（该服务端没有 v1 接口，可能为 3.x，请在连接设置中切换版本）'
}

/**
 * Nacos OpenAPI 客户端，支持两大版本线路（连接设置中选择）：
 * - 2.x：登录 /nacos/v1/auth/login；控制台 /nacos/v1/console/*（已对本地 2.4.3 实测）
 * - 3.x：登录 /nacos/v1/auth/login；控制台 /nacos/v3/console/*（已对 docker 3.2.3 实测）
 * 特性：token 缓存与过期前 120s 自动续期；401/403 自动重登重试一次；
 * 服务端未开启鉴权（登录接口 404/405）时自动降级为无 token 模式。
 */
export class NacosClient {
  private token: string | null = null
  private tokenExpiresAt = 0
  private authDisabled = false
  /** v3 接口前缀探测结果（不同部署方式前缀不同），resetAuth 时清空 */
  private v3Prefix: string | null = null

  constructor(private readonly getSettings: () => NacosSettings) {}

  resetAuth(): void {
    this.token = null
    this.tokenExpiresAt = 0
    this.authDisabled = false
    this.v3Prefix = null
  }

  private baseUrl(override?: NacosSettings): string {
    const s = override ?? this.getSettings()
    return s.serverUrl.trim().replace(/\/+$/, '')
  }

  private version(override?: NacosSettings): 'v2' | 'v3' {
    const s = override ?? this.getSettings()
    return s.apiVersion === 'v3' ? 'v3' : 'v2'
  }

  /** 测试连接：用给定的（未保存的）设置登录并拉取命名空间列表。 */
  static async testConnection(settings: NacosSettings): Promise<NamespaceInfo[]> {
    const tmp = new NacosClient(() => settings)
    return tmp.listNamespaces()
  }

  private async getToken(force = false): Promise<string> {
    if (this.authDisabled) return ''
    if (!force && this.token && Date.now() < this.tokenExpiresAt) return this.token

    const s = this.getSettings()
    const loginBody = new URLSearchParams({ username: s.username, password: s.password })
    const doLogin = (path: string) =>
      fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: loginBody,
        signal: AbortSignal.timeout(8000)
      })

    let res: Response
    try {
      res = await doLogin('/nacos/v1/auth/login')
    } catch (e) {
      throw new Error(`网络连接失败，无法访问 ${this.baseUrl()}：${errMsg(e)}`)
    }

    // 3.x 的 console 端口 context path 为 /，登录路径没有 /nacos 前缀；
    // 该端口对不存在路径返回 404 或包装成 500「No static resource」，均尝试回退路径
    if (res.status === 404 || res.status === 405) {
      try {
        res = await doLogin('/v1/auth/login')
      } catch (e) {
        throw new Error(`网络连接失败，无法访问 ${this.baseUrl()}：${errMsg(e)}`)
      }
    } else if (res.status === 500) {
      const body = await res.text()
      if (body.includes('No static resource')) {
        try {
          res = await doLogin('/v1/auth/login')
        } catch (e) {
          throw new Error(`网络连接失败，无法访问 ${this.baseUrl()}：${errMsg(e)}`)
        }
      } else {
        throw new Error(`登录失败：HTTP 500 ${body.slice(0, 200)}`)
      }
    }

    // 服务端未开启鉴权时，部分版本登录接口返回 404/405
    if (res.status === 404 || res.status === 405) {
      this.authDisabled = true
      return ''
    }

    const text = await res.text()
    if (res.status === 401 || res.status === 403) {
      throw new Error('登录失败：用户名或密码错误')
    }
    if (!res.ok) {
      throw new Error(`登录失败：HTTP ${res.status} ${text.slice(0, 200)}`)
    }

    let data: { accessToken?: string; tokenTtl?: number }
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`登录失败：响应不是 JSON：${text.slice(0, 120)}`)
    }
    if (!data.accessToken) {
      // 有些未开启鉴权的服务返回 200 但无 token
      this.authDisabled = true
      return ''
    }

    this.token = data.accessToken
    const ttlMs = (data.tokenTtl ?? 18000) * 1000
    this.tokenExpiresAt = Date.now() + Math.max(ttlMs - 120_000, 60_000)
    return this.token
  }

  /** 鉴权失败自动重试一次的包装。 */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof AuthError) {
        this.token = null
        this.tokenExpiresAt = 0
        return await fn()
      }
      throw e
    }
  }

  private async request(pathWithQuery: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken()
    const sep = pathWithQuery.includes('?') ? '&' : '?'
    const url = token
      ? `${this.baseUrl()}${pathWithQuery}${sep}accessToken=${encodeURIComponent(token)}`
      : `${this.baseUrl()}${pathWithQuery}`

    let res: Response
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) })
    } catch (e) {
      throw new Error(`网络连接失败：${errMsg(e)}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`鉴权失败（HTTP ${res.status}）：${PERMISSION_HINT}`)
    }
    return res
  }

  /**
   * v3 接口请求。不同部署方式前缀不同（server 端口带 /nacos 且走 admin，
   * console 端口 context 为 / 且走 console），按候选顺序探测，首个非 404 命中后缓存前缀。
   * console 优先：其命名空间接口仅校验身份（ONLY_IDENTITY），非管理员账号也能用；
   * 配置接口按命名空间权限校验。admin 接口（server 端口）则需要全局管理员角色。
   * @param path 如 `/core/namespace/list`
   */
  private async v3Request(path: string, init?: RequestInit): Promise<Response> {
    const prefixes = this.v3Prefix
      ? [this.v3Prefix]
      : ['/v3/console', '/nacos/v3/console', '/nacos/v3/admin', '/v3/admin']
    let last: Response | null = null
    for (const prefix of prefixes) {
      const res = await this.request(`${prefix}${path}`, init)
      if (res.status !== 404) {
        this.v3Prefix = prefix
        return res
      }
      last = res
    }
    return last as Response
  }

  /** v3 中 public 命名空间的 tenant 为 "public"，与 2.x 的 "" 互相映射，保持上层无感。 */
  private tenantFor(version: 'v2' | 'v3', tenant: string): string {
    return version === 'v3' && tenant === '' ? 'public' : tenant
  }

  private tenantFromServer(version: 'v2' | 'v3', id: string): string {
    return version === 'v3' && id === 'public' ? '' : id
  }

  /** 解析带 code 的响应体：校验成功码并返回整个 body。 */
  private parseBody(text: string, action: string): { code?: number; message?: string } & Record<
    string,
    unknown
  > {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`${action}响应解析失败：${text.slice(0, 120)}`)
    }
    const code = data.code as number | undefined
    if (code === 401 || code === 403) {
      throw new AuthError(`鉴权失败（code=${code}）：${String(data.message ?? '')}。${PERMISSION_HINT}`)
    }
    if (!isSuccessCode(code)) {
      throw new Error(`${action}失败（code=${code}）：${String(data.message ?? '')}`)
    }
    return data as { code?: number; message?: string } & Record<string, unknown>
  }

  async listNamespaces(): Promise<NamespaceInfo[]> {
    const version = this.version()
    return this.call(async () => {
      const res =
        version === 'v3'
          ? await this.v3Request('/core/namespace/list')
          : await this.request('/nacos/v1/console/namespaces')
      const text = await res.text()
      if (res.status === 404) {
        throw new Error(`获取命名空间失败：HTTP 404 ${versionHint(version)}`)
      }
      if (!res.ok) {
        throw new Error(`获取命名空间失败：HTTP ${res.status} ${text.slice(0, 200)}`)
      }
      const body = this.parseBody(text, '获取命名空间')

      // v1：data 直接是数组；v3：data 是数组或 {pageItems/...}
      let raw: unknown = body.data
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const inner = raw as Record<string, unknown>
        raw = inner.pageItems ?? inner.namespaces ?? []
      }
      if (!Array.isArray(raw)) {
        throw new Error('获取命名空间失败：响应格式异常')
      }

      const items: NamespaceInfo[] = raw.map((d) => {
        const rawId = String(
          (d as Record<string, unknown>).namespace ??
            (d as Record<string, unknown>).namespaceId ??
            ''
        )
        const id = this.tenantFromServer(version, rawId)
        return {
          namespace: id,
          namespaceShowName: String(
            (d as Record<string, unknown>).namespaceShowName ??
              (d as Record<string, unknown>).namespaceName ??
              rawId ??
              'public'
          ),
          configCount: Number((d as Record<string, unknown>).configCount ?? 0),
          type: Number((d as Record<string, unknown>).type ?? 2)
        }
      })
      // v3 列表可能不含 public，补一个空 tenant 项保持两版本行为一致
      if (!items.some((n) => n.namespace === '')) {
        items.unshift({ namespace: '', namespaceShowName: 'public', configCount: 0, type: 0 })
      }
      return items
    })
  }

  /** 拉取命名空间下全部配置（含内容），自动翻页。 */
  async listConfigs(tenant: string): Promise<ConfigItem[]> {
    const version = this.version()
    return this.call(async () => {
      const items: ConfigItem[] = []
      const pageSize = 100
      let pageNo = 1
      for (;;) {
        const path =
          version === 'v3'
            ? `/cs/config/list?search=accurate&dataId=&group=` +
              `&namespaceId=${encodeURIComponent(this.tenantFor(version, tenant))}&pageNo=${pageNo}&pageSize=${pageSize}`
            : `/nacos/v1/cs/configs?search=accurate&dataId=&group=` +
              `&tenant=${encodeURIComponent(tenant)}&pageNo=${pageNo}&pageSize=${pageSize}`
        const res =
          version === 'v3' ? await this.v3Request(path) : await this.request(path)
        const text = await res.text()
        if (res.status === 404) {
          throw new Error(`获取配置列表失败：HTTP 404 ${versionHint(version)}`)
        }
        if (!res.ok) {
          throw new Error(`获取配置列表失败：HTTP ${res.status} ${text.slice(0, 200)}`)
        }
        const body = this.parseBody(text, '获取配置列表')

        // v1：顶层 totalCount/pageItems；v2/v3：包在 data 里
        let payload: Record<string, unknown> = body
        if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
          payload = body.data as Record<string, unknown>
        }
        const pageItems = Array.isArray(payload.pageItems)
          ? payload.pageItems
          : Array.isArray(body.data)
            ? (body.data as unknown[])
            : []
        if (version === 'v3') {
          // v3 列表不含 content，需逐条取详情（小并发）
          for (let i = 0; i < pageItems.length; i += 8) {
            const chunk = pageItems.slice(i, i + 8)
            await Promise.all(
              chunk.map(async (it) => {
                const o = it as Record<string, unknown>
                const dataId = String(o.dataId ?? '')
                const group = String(o.group ?? o.groupName ?? 'DEFAULT_GROUP')
                let content = ''
                try {
                  const dRes = await this.v3Request(
                    `/cs/config?dataId=${encodeURIComponent(dataId)}` +
                      `&groupName=${encodeURIComponent(group)}` +
                      `&namespaceId=${encodeURIComponent(this.tenantFor(version, tenant))}`
                  )
                  const dText = await dRes.text()
                  if (dRes.ok) {
                    const dBody = this.parseBody(dText, '获取配置详情')
                    const d = (dBody.data ?? dBody) as Record<string, unknown>
                    if (typeof d.content === 'string') content = d.content
                  }
                } catch {
                  // 单条详情失败不阻断整页，内容留空并在界面上表现为差异
                }
                items.push({ dataId, group, type: String(o.type ?? 'text'), content })
              })
            )
          }
        } else {
          for (const it of pageItems) {
            const o = it as Record<string, unknown>
            items.push({
              dataId: String(o.dataId ?? ''),
              group: String(o.group ?? o.groupName ?? 'DEFAULT_GROUP'),
              type: String(o.type ?? 'text'),
              content: typeof o.content === 'string' ? o.content : ''
            })
          }
        }
        const total = Number(payload.totalCount ?? items.length)
        if (items.length >= total || pageItems.length === 0 || pageNo >= 100) break
        pageNo++
      }
      return items
    })
  }

  /** 发布（新建或覆盖）一条配置到目标命名空间。 */
  async publishConfig(p: PublishRequest): Promise<void> {
    const version = this.version()
    return this.call(async () => {
      const token = await this.getToken()
      const params: Record<string, string> =
        version === 'v3'
          ? {
              // v3 控制台接口的参数名与 v1 不同，两种拼法都带上以兼容小版本差异
              dataId: p.dataId,
              group: p.group,
              groupName: p.group,
              tenant: p.tenant,
              namespaceId: p.tenant,
              content: p.content,
              type: p.type || 'text'
            }
          : {
              dataId: p.dataId,
              group: p.group,
              tenant: p.tenant,
              content: p.content,
              type: p.type || 'text'
            }
      const body = new URLSearchParams(params)
      if (token) body.set('accessToken', token)

      const res =
        version === 'v3'
          ? await this.v3Request('/cs/config', { method: 'POST', body })
          : await fetch(`${this.baseUrl()}/nacos/v1/cs/configs`, {
              method: 'POST',
              body,
              signal: AbortSignal.timeout(20000)
            })

      const text = (await res.text()).trim()
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`发布鉴权失败（HTTP ${res.status}）`)
      }
      if (res.status === 404) {
        throw new Error(`发布失败：HTTP 404 ${versionHint(version)}`)
      }
      if (!res.ok) {
        throw new Error(`发布失败：HTTP ${res.status} ${text.slice(0, 200)}`)
      }
      // v1 返回纯文本 true/false；v3 返回 JSON {code:0,...}
      if (text === 'true') return
      if (text === 'false') {
        throw new Error('发布失败：Nacos 返回 false（请检查 dataId/group/命名空间是否合法）')
      }
      if (text.startsWith('{')) {
        this.parseBody(text, '发布') // 校验成功码，失败会抛错
        return
      }
      throw new Error(`发布失败：${text.slice(0, 200)}`)
    })
  }
}
