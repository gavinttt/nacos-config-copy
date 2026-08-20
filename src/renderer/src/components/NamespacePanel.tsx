import { FileSearchOutlined, ReloadOutlined } from '@ant-design/icons'
import { App, Button, Select, Space } from 'antd'
import { errMsg, useAppStore } from '../store/app-store'

export function NamespacePanel(): React.ReactElement {
  const { modal, message } = App.useApp()
  const namespaces = useAppStore((s) => s.namespaces)
  const sourceTenant = useAppStore((s) => s.sourceTenant)
  const targetTenant = useAppStore((s) => s.targetTenant)
  const selectSource = useAppStore((s) => s.selectSource)
  const selectTarget = useAppStore((s) => s.selectTarget)
  const setRulesOpen = useAppStore((s) => s.setRulesOpen)
  const loadRows = useAppStore((s) => s.loadRows)
  const loadingRows = useAppStore((s) => s.loadingRows)
  const hasUnsavedEdits = useAppStore((s) => s.hasUnsavedEdits)

  const options = namespaces.map((n) => ({
    label:
      n.namespace === ''
        ? `${n.namespaceShowName}（public）`
        : `${n.namespaceShowName}（${n.namespace}）`,
    value: n.namespace
  }))

  const doRefresh = async (): Promise<void> => {
    try {
      await loadRows()
      message.success('已刷新')
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const refresh = (): void => {
    if (sourceTenant === null || targetTenant === null) {
      message.info('请先选择源命名空间和目标命名空间')
      return
    }
    if (hasUnsavedEdits()) {
      modal.confirm({
        title: '确认刷新',
        content: '当前存在已修改未发布的编辑，刷新将丢弃这些编辑。是否继续？',
        okText: '丢弃并刷新',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: doRefresh
      })
    } else {
      void doRefresh()
    }
  }

  const openRules = (): void => {
    if (targetTenant === null) {
      message.info('请先选择目标命名空间')
      return
    }
    setRulesOpen(true)
  }

  return (
    <div className="namespace-panel">
      <div className="namespace-row">
        <span className="namespace-row-label">源命名空间</span>
        <Select
          style={{ flex: 1 }}
          showSearch
          allowClear
          optionFilterProp="label"
          placeholder="选择源命名空间"
          options={options}
          value={sourceTenant ?? undefined}
          onChange={(v: string | undefined) => selectSource(v ?? null)}
        />
      </div>
      <div className="namespace-row">
        <span className="namespace-row-label">目标命名空间</span>
        <Select
          style={{ flex: 1 }}
          showSearch
          allowClear
          optionFilterProp="label"
          placeholder="选择目标命名空间"
          options={options}
          value={targetTenant ?? undefined}
          onChange={(v: string | undefined) => selectTarget(v ?? null)}
        />
      </div>
      <Space>
        <Button icon={<FileSearchOutlined />} onClick={openRules}>
          替换规则
        </Button>
        <Button icon={<ReloadOutlined />} loading={loadingRows} onClick={refresh}>
          刷新
        </Button>
      </Space>
    </div>
  )
}
