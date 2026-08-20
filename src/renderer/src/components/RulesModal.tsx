import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Modal, Space, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'
import type { ReplacementRule } from '@shared/types'
import { errMsg, useAppStore } from '../store/app-store'

export function RulesModal(): React.ReactElement {
  const { message } = App.useApp()
  const open = useAppStore((s) => s.rulesOpen)
  const setOpen = useAppStore((s) => s.setRulesOpen)
  const rules = useAppStore((s) => s.rules)
  const saveRules = useAppStore((s) => s.saveRules)
  const targetTenant = useAppStore((s) => s.targetTenant)
  const namespaces = useAppStore((s) => s.namespaces)
  const [draft, setDraft] = useState<ReplacementRule[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(rules.map((r) => ({ ...r })))
  }, [open, rules])

  const targetName =
    namespaces.find((n) => n.namespace === targetTenant)?.namespaceShowName ?? targetTenant ?? ''

  const update = (id: string, patch: Partial<ReplacementRule>): void => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const cleaned = draft.filter((r) => r.keyPath.trim() !== '')
      await saveRules(cleaned)
      message.success('规则已保存，对比预览已按新规则重算')
      setOpen(false)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<ReplacementRule> = [
    {
      title: '启用',
      width: 56,
      render: (_v, r) => (
        <Switch size="small" checked={r.enabled} onChange={(v) => update(r.id, { enabled: v })} />
      )
    },
    {
      title: 'DataId',
      width: 168,
      render: (_v, r) => (
        <Input
          size="small"
          placeholder="空 = 全部配置"
          value={r.dataId ?? ''}
          onChange={(e) => update(r.id, { dataId: e.target.value })}
        />
      )
    },
    {
      title: 'Key 路径',
      render: (_v, r) => (
        <Input
          size="small"
          placeholder="如 login.baseUrl / redis.*.host"
          value={r.keyPath}
          onChange={(e) => update(r.id, { keyPath: e.target.value })}
        />
      )
    },
    {
      title: '替换值',
      render: (_v, r) => (
        <Input
          size="small"
          placeholder="如 http://svc.internal:3300"
          value={r.value}
          onChange={(e) => update(r.id, { value: e.target.value })}
        />
      )
    },
    {
      title: '',
      width: 44,
      render: (_v, r) => (
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => setDraft((d) => d.filter((x) => x.id !== r.id))}
        />
      )
    }
  ]

  return (
    <Modal
      title={
        <Space>
          替换规则
          <Tag color="blue">目标命名空间：{targetName}</Tag>
        </Space>
      }
      open={open}
      width={720}
      onCancel={() => setOpen(false)}
      footer={
        <Space>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="把源命名空间配置拷贝到目标命名空间时，配置中 Key 路径位置的值会被替换为「替换值」。"
        description={
          <div style={{ fontSize: 12 }}>
            DataId 限定规则只对指定文件名生效，支持 * 通配符（如 *-application.yaml），留空对所有配置生效；
            Key 路径支持 yaml / json 嵌套路径（如 login.baseUrl）、数组下标（如 hosts.0.url）与
            * 通配段（如 redis.*.host = 数组中每个元素的 host）；
            路径不存在时跳过并给出警告；无法识别的格式保持原样。
          </div>
        }
      />
      <Table<ReplacementRule>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={draft}
        pagination={false}
        locale={{ emptyText: '暂无规则' }}
      />
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        style={{ marginTop: 12 }}
        onClick={() =>
          setDraft((d) => [
            ...d,
            { id: crypto.randomUUID(), keyPath: '', value: '', enabled: true, dataId: '' }
          ])
        }
      >
        添加规则
      </Button>
    </Modal>
  )
}
