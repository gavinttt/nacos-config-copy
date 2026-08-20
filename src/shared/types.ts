/** Nacos 服务端大版本：2.x 走 /v1 控制台接口，3.x 走 /v3 控制台接口。 */
export type NacosApiVersion = 'v2' | 'v3'

/** 连接设置（持久化存储）。serverUrl 统一去除末尾 "/"。 */
export interface NacosSettings {
  serverUrl: string
  username: string
  password: string
  apiVersion: NacosApiVersion
}

/** GET /nacos/v1/console/namespaces 返回的命名空间信息。public 命名空间的 namespace 为 ""。 */
export interface NamespaceInfo {
  namespace: string
  namespaceShowName: string
  configCount: number
  type: number
}

/** 一条 Nacos 配置（列表接口直接返回 content）。 */
export interface ConfigItem {
  dataId: string
  group: string
  type: string
  content: string
}

/** 针对目标命名空间的替换规则：把配置中 keyPath 位置的值替换为 value。 */
export interface ReplacementRule {
  id: string
  keyPath: string
  value: string
  enabled: boolean
  /** 生效范围：空 = 所有配置；否则仅匹配该 DataId（支持 * 通配符，如 *-application.yaml） */
  dataId?: string
}

/** 发布请求（Nacos 该接口为新建或覆盖）。 */
export interface PublishRequest {
  tenant: string
  dataId: string
  group: string
  content: string
  type: string
}

/** 上次选择的命名空间（会话恢复）。 */
export interface SessionState {
  sourceTenant: string | null
  targetTenant: string | null
}

/** 规则引擎输出。 */
export interface ApplyResult {
  content: string
  changed: boolean
  warnings: string[]
}

/** 配置行状态。 */
export type ConfigStatus =
  | 'pending' // 未处理（加载中）
  | 'same' // 无差异
  | 'diff' // 有差异
  | 'edited' // 已修改未发布
  | 'published' // 已发布
  | 'error' // 发布失败

/** 每条配置在渲染层的工作状态。 */
export interface ConfigRowState {
  key: string
  dataId: string
  group: string
  type: string
  /** 源命名空间内容 */
  sourceContent: string
  /** 目标命名空间当前内容；null = 目标不存在 */
  targetContent: string | null
  /** applyRules(源内容) 的结果 */
  preview: string
  previewWarnings: string[]
  /** 右侧初始值 = 目标已有内容 ?? preview */
  baseline: string
  /** diff 左栏当前文本（可编辑） */
  leftBuffer: string
  /** diff 右栏当前文本（可编辑），即待发布内容 */
  rightBuffer: string
  /** 最近一次成功发布的内容快照 */
  publishedContent: string | null
  lastPublishError: string | null
  status: ConfigStatus
}
