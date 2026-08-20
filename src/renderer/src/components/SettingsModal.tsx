import { App, Button, Form, Input, Modal, Radio, Space } from 'antd'
import { useEffect, useState } from 'react'
import type { NacosSettings } from '@shared/types'
import { errMsg, useAppStore } from '../store/app-store'

const DEFAULT_SETTINGS: NacosSettings = {
  serverUrl: 'http://localhost:8848',
  username: 'nacos',
  password: 'nacos',
  apiVersion: 'v2'
}

export function SettingsModal(): React.ReactElement {
  const { message } = App.useApp()
  const open = useAppStore((s) => s.settingsOpen)
  const settings = useAppStore((s) => s.settings)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const applySettings = useAppStore((s) => s.applySettings)
  const [form] = Form.useForm<NacosSettings>()
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (open) {
      form.setFieldsValue(settings ?? DEFAULT_SETTINGS)
    }
  }, [open, settings, form])

  const testConnection = async (): Promise<void> => {
    let values: NacosSettings
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setTesting(true)
    try {
      const { namespaces } = await window.api.testNacos(values)
      message.success(`连接成功，共 ${namespaces.length} 个命名空间`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    let values: NacosSettings
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    await window.api.saveSettings(values)
    await applySettings(values)
    message.success('连接设置已保存')
    setOpen(false)
  }

  return (
    <Modal
      title="连接设置"
      open={open}
      onCancel={() => setOpen(false)}
      footer={
        <Space>
          <Button loading={testing} onClick={() => void testConnection()}>
            测试连接
          </Button>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button type="primary" onClick={() => void save()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="apiVersion" label="服务端版本" rules={[{ required: true }]}>
          <Radio.Group
            options={[
              { label: '2.x（/v1 接口，如 2.4.3）', value: 'v2' },
              { label: '3.x（/v3 接口，如 3.2.3）', value: 'v3' }
            ]}
            optionType="button"
          />
        </Form.Item>
        <Form.Item
          name="serverUrl"
          label="服务地址"
          rules={[{ required: true, message: '请输入 Nacos 服务地址' }]}
        >
          <Input placeholder="http://localhost:8848" />
        </Form.Item>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input placeholder="nacos" autoComplete="off" />
        </Form.Item>
        <Form.Item name="password" label="密码">
          <Input.Password placeholder="nacos" autoComplete="off" />
        </Form.Item>
        <div style={{ color: '#999', fontSize: 12 }}>
          说明：密码以明文保存在本机应用数据目录（内部工具）。
          <br />
          请注意端口：2.x 和 3.x 的 API 端口默认 8848；3.x 的 console（Web）端口默认 8080，与 API 端口不同。
          管理员账号（ROLE_ADMIN）服务地址填 API 端口；最小权限账号（按命名空间授权）填 console 端口。
        </div>
      </Form>
    </Modal>
  )
}
