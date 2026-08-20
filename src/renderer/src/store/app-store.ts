import { create } from 'zustand'
import { applyRules } from '@shared/rules'
import type { ConfigRowState, NacosSettings, NamespaceInfo, ReplacementRule } from '@shared/types'
import { buildRows, computeRowStatus } from './status'

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface AppState {
  initialized: boolean
  settings: NacosSettings | null
  connected: boolean
  namespaces: NamespaceInfo[]
  sourceTenant: string | null
  targetTenant: string | null
  /** 当前目标命名空间的规则 */
  rules: ReplacementRule[]
  rows: ConfigRowState[]
  loadingRows: boolean
  selectedKey: string | null
  settingsOpen: boolean
  rulesOpen: boolean

  init: () => Promise<void>
  refreshNamespaces: () => Promise<void>
  selectSource: (tenant: string | null) => void
  selectTarget: (tenant: string | null) => void
  loadRows: () => Promise<void>
  setSelected: (key: string | null) => void
  updateLeft: (key: string, text: string) => void
  updateRight: (key: string, text: string) => void
  setMergeWarnings: (key: string, warnings: string[]) => void
  publishRow: (key: string) => Promise<void>
  saveRules: (rules: ReplacementRule[]) => Promise<void>
  applySettings: (settings: NacosSettings) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setRulesOpen: (open: boolean) => void
  hasUnsavedEdits: () => boolean
}

export const useAppStore = create<AppState>((set, get) => {
  const persistSession = (): void => {
    const { sourceTenant, targetTenant } = get()
    void window.api.saveSession({ sourceTenant, targetTenant })
  }

  const updateRow = (key: string, patch: (r: ConfigRowState) => ConfigRowState): void => {
    set((state) => ({
      rows: state.rows.map((r) => (r.key === key ? patch(r) : r))
    }))
  }

  return {
    initialized: false,
    settings: null,
    connected: false,
    namespaces: [],
    sourceTenant: null,
    targetTenant: null,
    rules: [],
    rows: [],
    loadingRows: false,
    selectedKey: null,
    settingsOpen: false,
    rulesOpen: false,

    init: async () => {
      if (get().initialized) return
      set({ initialized: true })
      const settings = await window.api.getSettings()
      const session = await window.api.getSession()
      set({ settings })

      try {
        await get().refreshNamespaces()
      } catch {
        return // 连接失败时由用户打开设置界面处理
      }

      const ns = get().namespaces
      const valid = (t: string | null): boolean =>
        t !== null && ns.some((n) => n.namespace === t)
      const source = valid(session.sourceTenant) ? session.sourceTenant : null
      const target = valid(session.targetTenant) ? session.targetTenant : null
      if (source !== null || target !== null) {
        set({ sourceTenant: source, targetTenant: target })
        if (source !== null && target !== null) {
          await get().loadRows().catch(() => undefined)
        }
      }
    },

    refreshNamespaces: async () => {
      try {
        const namespaces = await window.api.listNamespaces()
        set({ namespaces, connected: true })
      } catch (e) {
        set({ namespaces: [], connected: false })
        throw e
      }
    },

    selectSource: (tenant) => {
      set({ sourceTenant: tenant, selectedKey: null, rows: [] })
      persistSession()
      if (tenant !== null && get().targetTenant !== null) {
        void get().loadRows().catch(() => undefined)
      }
    },

    selectTarget: (tenant) => {
      set({ targetTenant: tenant, selectedKey: null, rows: [] })
      persistSession()
      if (tenant !== null && get().sourceTenant !== null) {
        void get().loadRows().catch(() => undefined)
      }
    },

    loadRows: async () => {
      const { sourceTenant, targetTenant } = get()
      if (sourceTenant === null || targetTenant === null) return
      set({ loadingRows: true, selectedKey: null })
      try {
        const [sourceItems, targetItems, rules] = await Promise.all([
          window.api.listConfigs(sourceTenant),
          window.api.listConfigs(targetTenant),
          window.api.getRules(targetTenant)
        ])
        set({ rows: buildRows(sourceItems, targetItems, rules), rules, loadingRows: false })
      } catch (e) {
        set({ loadingRows: false, rows: [] })
        throw e
      }
    },

    setSelected: (key) => set({ selectedKey: key }),

    updateLeft: (key, text) => updateRow(key, (r) => ({ ...r, leftBuffer: text })),

    updateRight: (key, text) =>
      updateRow(key, (r) => {
        const next = { ...r, rightBuffer: text }
        next.status = computeRowStatus(next)
        return next
      }),

    setMergeWarnings: (key, warnings) =>
      updateRow(key, (r) => ({ ...r, previewWarnings: warnings })),

    publishRow: async (key) => {
      const { rows, targetTenant } = get()
      const row = rows.find((r) => r.key === key)
      if (!row || targetTenant === null) return
      try {
        await window.api.publishConfig({
          tenant: targetTenant,
          dataId: row.dataId,
          group: row.group,
          content: row.rightBuffer,
          type: row.type
        })
        updateRow(key, (r) => {
          const next = {
            ...r,
            publishedContent: r.rightBuffer,
            targetContent: r.rightBuffer,
            baseline: r.rightBuffer,
            lastPublishError: null
          }
          next.status = computeRowStatus(next)
          return next
        })
      } catch (e) {
        updateRow(key, (r) => {
          const next = { ...r, lastPublishError: errMsg(e) }
          next.status = computeRowStatus(next)
          return next
        })
        throw e
      }
    },

    saveRules: async (rules) => {
      const { targetTenant } = get()
      if (targetTenant === null) return
      await window.api.saveRules(targetTenant, rules)
      set((state) => ({
        rules,
        rows: state.rows.map((r) => {
          const { content: preview, warnings } = applyRules(
            r.leftBuffer,
            r.type,
            r.dataId,
            rules
          )
          // 右侧未手工编辑时跟随新的规则预览；已编辑则保留用户内容
          const untouched = r.rightBuffer === r.baseline
          const baseline = r.targetContent !== null ? r.targetContent : preview
          const next = {
            ...r,
            preview,
            previewWarnings: warnings,
            baseline,
            rightBuffer: untouched ? baseline : r.rightBuffer
          }
          next.status = computeRowStatus(next)
          return next
        })
      }))
    },

    applySettings: async (settings) => {
      set({ settings })
      try {
        await get().refreshNamespaces()
      } catch {
        // 连接失败保留旧列表，TopBar 会显示未连接
      }
      const { sourceTenant, targetTenant } = get()
      if (sourceTenant !== null && targetTenant !== null) {
        await get().loadRows().catch(() => undefined)
      }
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setRulesOpen: (open) => set({ rulesOpen: open }),

    hasUnsavedEdits: () => get().rows.some((r) => r.status === 'edited')
  }
})
