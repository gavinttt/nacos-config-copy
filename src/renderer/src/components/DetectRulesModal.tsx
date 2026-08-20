import { App, Button, Checkbox, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'
import type { RuleCandidate } from '@shared/rules/detect'
import { errMsg, useAppStore } from '../store/app-store'

interface DraftCandidate extends RuleCandidate {
  id: string
}

interface Props {
  open: boolean
  dataId: string
  candidates: RuleCandidate[]
  onClose: () => void
}

/**
 * 自动检测替换规则：展示左右值差异归纳出的候选规则，
 * 勾选需要的（可修改替换值），保存进目标命名空间的替换规则。
 */
export function DetectRulesModal({ open, dataId, candidates, onClose }: Props): React.ReactElement {
  const { message } = App.useApp()
  const [draft, setDraft] = useState<DraftCandidate[]>([])
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [onlyCurrent, setOnlyCurrent] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      const d = candidates.map((c, i) => ({ ...c, id: String(i) }))
      setDraft(d)
      setSelectedKeys(d.map((x) => x.id)) // 默认全选
      setOnlyCurrent(true)
    }
  }, [open, candidates])

  const update = (id: string, patch: Partial<DraftCandidate>): void => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const save = async (): Promise<void> => {
    const rows = draft.filter((d) => selectedKeys.includes(d.id))
    if (rows.length === 0) {
      message.warning('请至少勾选一条规则')
      return
    }
    const st = useAppStore.getState()
    const scope = onlyCurrent ? dataId : ''
    const next = st.rules.map((r) => ({ ...r }))
    let added = 0
    let updated = 0
    for (const c of rows) {
      const keyPath = c.keyPath.trim()
      if (!keyPath) continue
      const found = next.find(
        (r) => r.keyPath.trim() === keyPath && (r.dataId ?? '').trim() === scope
      )
      if (found) {
        found.value = c.rightValue
        found.enabled = true
        updated++
      } else {
        next.push({
          id: crypto.randomUUID(),
          keyPath,
          value: c.rightValue,
          enabled: true,
          dataId: scope
        })
        added++
      }
    }
    setSaving(true)
    try {
      await st.saveRules(next)
      message.success(`替换规则已保存：新增 ${added} 条，更新 ${updated} 条`)
      onClose()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<DraftCandidate> = [
    {
      title: 'Key 路径',
      width: 210,
      render: (_v, r) => (
        <Typography.Text
          style={{ fontFamily: 'monospace', display: 'block' }}
          ellipsis={{ tooltip: r.keyPath }}
        >
          {r.keyPath}
        </Typography.Text>
      )
    },
    {
      title: '左侧当前值', // 截断显示，悬停 Tooltip 展示完整值
      render: (_v, r) => (
        <Typography.Text
          type="secondary"
          style={{ display: 'block' }}
          ellipsis={{ tooltip: r.leftValue }}
        >
          {r.leftValue}
        </Typography.Text>
      )
    },
    {
      title: '替换值（可修改）',
      render: (_v, r) => (
        <Input
          size="small"
          value={r.rightValue}
          onChange={(e) => update(r.id, { rightValue: e.target.value })}
        />
      )
    }
  ]

  return (
    <Modal
      title={
        <Space>
          自动检测替换规则
          <Tag color="blue">{dataId}</Tag>
        </Space>
      }
      open={open}
      width={780}
      onCancel={onClose}
      footer={
        <Space>
          <Checkbox checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)}>
            仅对当前 DataId 生效
          </Checkbox>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存勾选的 {selectedKeys.length} 条规则
          </Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 12, color: '#666', fontSize: 12 }}>
        以下是左右两侧的值差异归纳出的候选规则（数组中统一变化的项已归纳为 * 通配）。
        勾选需要的规则保存后，左侧内容应用规则即可得到右侧这些值；增删行等结构差异请使用「自动合并」。
      </div>
      <Table<DraftCandidate>
        size="small"
        rowKey="id"
        tableLayout="fixed"
        columns={columns}
        dataSource={draft}
        pagination={false}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys)
        }}
      />
    </Modal>
  )
}
