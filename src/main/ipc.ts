import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { NacosSettings, PublishRequest, ReplacementRule, SessionState } from '@shared/types'
import { NacosClient } from './nacos-client'
import { AppStore } from './store'

/** 注册全部 IPC handler。handler 内抛出的 Error 消息会原样传回渲染进程。 */
export function registerIpcHandlers(client: NacosClient, store: AppStore): void {
  ipcMain.handle(IpcChannels.SettingsGet, () => store.getSettings())

  ipcMain.handle(IpcChannels.SettingsSave, (_e, settings: NacosSettings) => {
    store.saveSettings(settings)
    client.resetAuth()
  })

  ipcMain.handle(IpcChannels.NacosTest, async (_e, settings: NacosSettings) => {
    const namespaces = await NacosClient.testConnection(settings)
    return { namespaces }
  })

  ipcMain.handle(IpcChannels.NacosNamespaces, () => client.listNamespaces())

  ipcMain.handle(IpcChannels.NacosConfigs, (_e, p: { tenant: string }) =>
    client.listConfigs(p.tenant)
  )

  ipcMain.handle(IpcChannels.NacosPublish, (_e, p: PublishRequest) => client.publishConfig(p))

  ipcMain.handle(IpcChannels.RulesGet, (_e, p: { tenant: string }) => store.getRules(p.tenant))

  ipcMain.handle(
    IpcChannels.RulesSave,
    (_e, p: { tenant: string; rules: ReplacementRule[] }) => {
      store.saveRules(p.tenant, p.rules)
    }
  )

  ipcMain.handle(IpcChannels.SessionGet, () => store.getSession())

  ipcMain.handle(IpcChannels.SessionSave, (_e, session: SessionState) => {
    store.saveSession(session)
  })
}
