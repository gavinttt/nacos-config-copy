import Store from 'electron-store'
import type { NacosSettings, ReplacementRule, SessionState } from '@shared/types'

interface StoreSchema {
  settings: NacosSettings
  /** 按目标命名空间 tenantId 存储（public 为 ""） */
  rules: Record<string, ReplacementRule[]>
  session: SessionState
}

const DEFAULTS: StoreSchema = {
  settings: {
    serverUrl: 'http://localhost:8848',
    username: 'nacos',
    password: 'nacos',
    apiVersion: 'v2'
  },
  rules: {},
  session: { sourceTenant: null, targetTenant: null }
}

export class AppStore {
  private store = new Store<StoreSchema>({
    name: 'nacos-config-copy',
    defaults: DEFAULTS
  })

  getSettings(): NacosSettings {
    const s = this.store.get('settings')
    return { ...DEFAULTS.settings, ...s }
  }

  saveSettings(settings: NacosSettings): void {
    this.store.set('settings', {
      serverUrl: settings.serverUrl.trim().replace(/\/+$/, ''),
      username: settings.username.trim(),
      password: settings.password,
      apiVersion: settings.apiVersion === 'v3' ? 'v3' : 'v2'
    })
  }

  getRules(tenant: string): ReplacementRule[] {
    const all = this.store.get('rules') ?? {}
    return all[tenant] ?? []
  }

  saveRules(tenant: string, rules: ReplacementRule[]): void {
    const all = this.store.get('rules') ?? {}
    all[tenant] = rules
    this.store.set('rules', all)
  }

  getSession(): SessionState {
    const s = this.store.get('session')
    return {
      sourceTenant: s?.sourceTenant ?? null,
      targetTenant: s?.targetTenant ?? null
    }
  }

  saveSession(session: SessionState): void {
    this.store.set('session', session)
  }
}
