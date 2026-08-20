import { App } from 'antd'
import { errMsg, useAppStore } from '../store/app-store'

/** 弹出确认框后发布指定行（右侧内容 → 目标命名空间）。 */
export function usePublish(): (key: string) => void {
  const { modal, message } = App.useApp()

  return (key: string) => {
    const st = useAppStore.getState()
    const row = st.rows.find((r) => r.key === key)
    if (!row || st.targetTenant === null) return
    const target = st.namespaces.find((n) => n.namespace === st.targetTenant)
    const targetName = target?.namespaceShowName ?? st.targetTenant

    modal.confirm({
      title: '确认发布',
      content: `将把右侧内容发布到目标命名空间「${targetName}」：dataId=${row.dataId}，group=${row.group}。会覆盖目标命名空间中的同名配置，是否继续？`,
      okText: '确认发布',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await useAppStore.getState().publishRow(key)
          message.success(`已发布 ${row.dataId}`)
        } catch (e) {
          message.error(errMsg(e))
        }
      }
    })
  }
}
