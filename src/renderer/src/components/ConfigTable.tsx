import { Button, Empty, Space, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ConfigRowState } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { StatusBadge } from './StatusBadge'
import { usePublish } from './use-publish'

export function ConfigTable(): React.ReactElement {
  const rows = useAppStore((s) => s.rows)
  const loading = useAppStore((s) => s.loadingRows)
  const selectedKey = useAppStore((s) => s.selectedKey)
  const setSelected = useAppStore((s) => s.setSelected)
  const sourceTenant = useAppStore((s) => s.sourceTenant)
  const targetTenant = useAppStore((s) => s.targetTenant)
  const publish = usePublish()

  if (sourceTenant === null || targetTenant === null) {
    return <Empty style={{ marginTop: 48 }} description="请选择源命名空间和目标命名空间" />
  }

  const columns: ColumnsType<ConfigRowState> = [
    {
      title: '配置',
      dataIndex: 'dataId',
      ellipsis: true
    },
    {
      title: 'Group',
      dataIndex: 'group',
      width: 96,
      ellipsis: true
    },
    {
      title: '状态',
      width: 148,
      render: (_v, r) => <StatusBadge row={r} />
    },
    {
      title: '操作',
      width: 104,
      render: (_v, r) => (
        <Space size={0}>
          <Button
            size="small"
            type="link"
            onClick={(e) => {
              e.stopPropagation()
              setSelected(r.key)
            }}
          >
            对比
          </Button>
          <Button
            size="small"
            type="link"
            danger
            disabled={r.status === 'same' || r.status === 'published'}
            onClick={(e) => {
              e.stopPropagation()
              publish(r.key)
            }}
          >
            发布
          </Button>
        </Space>
      )
    }
  ]

  return (
    <Table<ConfigRowState>
      className="config-table"
      size="small"
      rowKey="key"
      tableLayout="fixed"
      loading={loading}
      columns={columns}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText: <Empty description="源命名空间下没有配置" /> }}
      onRow={(r) => ({ onClick: () => setSelected(r.key) })}
      rowClassName={(r) => (r.key === selectedKey ? 'config-table-row-selected' : '')}
    />
  )
}
