import type {
  ConfigItem,
  NacosSettings,
  NamespaceInfo,
  PublishRequest,
  ReplacementRule,
  SessionState
} from './types'

/** IPC 通道名常量。全部为 invoke/handle 请求-响应模式。 */
export const IpcChannels = {
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',
  NacosTest: 'nacos:test',
  NacosNamespaces: 'nacos:namespaces',
  NacosConfigs: 'nacos:configs',
  NacosPublish: 'nacos:publish',
  RulesGet: 'rules:get',
  RulesSave: 'rules:save',
  SessionGet: 'session:get',
  SessionSave: 'session:save'
} as const

/** preload 暴露给渲染进程的 API（window.api）。 */
export interface RendererApi {
  getSettings(): Promise<NacosSettings>
  saveSettings(settings: NacosSettings): Promise<void>
  /** 用未保存的表单值测试连接：登录并列出命名空间 */
  testNacos(settings: NacosSettings): Promise<{ namespaces: NamespaceInfo[] }>
  listNamespaces(): Promise<NamespaceInfo[]>
  /** 拉取命名空间下全部配置（内部自动翻页），含 content */
  listConfigs(tenant: string): Promise<ConfigItem[]>
  publishConfig(req: PublishRequest): Promise<void>
  getRules(tenant: string): Promise<ReplacementRule[]>
  saveRules(tenant: string, rules: ReplacementRule[]): Promise<void>
  getSession(): Promise<SessionState>
  saveSession(session: SessionState): Promise<void>
}
