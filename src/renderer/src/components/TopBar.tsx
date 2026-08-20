import { SettingOutlined } from '@ant-design/icons'
import { Badge, Button, Space, Tag } from 'antd'
import { useAppStore } from '../store/app-store'

export function TopBar(): React.JSX.Element {
  const connected = useAppStore((s) => s.connected)
  const settings = useAppStore((s) => s.settings)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#fff',
        borderBottom: '1px solid #e8e8e8'
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 15 }}>Nacos 配置拷贝</span>
      <Space size={6}>
        <Badge status={connected ? 'success' : 'error'} />
        <span style={{ color: connected ? '#389e0d' : '#cf1322' }}>
          {connected ? '已连接' : '未连接'}
        </span>
        {settings && (
          <Tag style={{ fontFamily: 'monospace' }}>
            {settings.serverUrl}（{settings.username} ·{' '}
            {settings.apiVersion === 'v3' ? '3.x' : '2.x'}）
          </Tag>
        )}
      </Space>
      <div style={{ flex: 1 }} />
      <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
        连接设置
      </Button>
    </div>
  )
}
