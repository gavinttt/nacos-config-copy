import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type RendererApi } from '@shared/ipc'
import type { NacosSettings, PublishRequest, ReplacementRule, SessionState } from '@shared/types'

const api: RendererApi = {
  getSettings: () => ipcRenderer.invoke(IpcChannels.SettingsGet),
  saveSettings: (settings: NacosSettings) =>
    ipcRenderer.invoke(IpcChannels.SettingsSave, settings),
  testNacos: (settings: NacosSettings) => ipcRenderer.invoke(IpcChannels.NacosTest, settings),
  listNamespaces: () => ipcRenderer.invoke(IpcChannels.NacosNamespaces),
  listConfigs: (tenant: string) => ipcRenderer.invoke(IpcChannels.NacosConfigs, { tenant }),
  publishConfig: (req: PublishRequest) => ipcRenderer.invoke(IpcChannels.NacosPublish, req),
  getRules: (tenant: string) => ipcRenderer.invoke(IpcChannels.RulesGet, { tenant }),
  saveRules: (tenant: string, rules: ReplacementRule[]) =>
    ipcRenderer.invoke(IpcChannels.RulesSave, { tenant, rules }),
  getSession: () => ipcRenderer.invoke(IpcChannels.SessionGet),
  saveSession: (session: SessionState) => ipcRenderer.invoke(IpcChannels.SessionSave, session)
}

contextBridge.exposeInMainWorld('api', api)
