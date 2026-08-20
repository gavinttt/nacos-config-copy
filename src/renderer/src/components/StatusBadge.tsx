import { Space, Tag, Tooltip } from 'antd'
import type { ConfigRowState, ConfigStatus } from '@shared/types'

const STATUS_META: Record<ConfigStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '未处理' },
  same: { color: 'green', text: '无差异' },
  diff: { color: 'orange', text: '有差异' },
  edited: { color: 'blue', text: '已修改未发布' },
  published: { color: 'green', text: '已发布' },
  error: { color: 'red', text: '发布失败' }
}

export function StatusBadge({ row }: { row: ConfigRowState }): React.JSX.Element {
  const meta = STATUS_META[row.status]
  const tag =
    row.status === 'error' ? (
      <Tooltip title={row.lastPublishError ?? ''}>
        <Tag color={meta.color}>{meta.text}</Tag>
      </Tooltip>
    ) : (
      <Tag color={meta.color}>{meta.text}</Tag>
    )

  return (
    <Space size={4}>
      {tag}
      {row.targetContent === null && <Tag color="purple">目标缺失</Tag>}
    </Space>
  )
}
