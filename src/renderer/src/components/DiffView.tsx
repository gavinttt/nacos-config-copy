import { DiffEditor } from '@monaco-editor/react'
import { Alert, App, Button, Empty, Space } from 'antd'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { applyRules, monacoLanguage } from '@shared/rules'
import { detectRuleCandidates, type RuleCandidate } from '@shared/rules/detect'
import { useAppStore } from '../store/app-store'
import { DetectRulesModal } from './DetectRulesModal'
import { StatusBadge } from './StatusBadge'
import { usePublish } from './use-publish'

/**
 * 双栏逐行对比视图（Monaco DiffEditor）：
 * - 左栏 = 源命名空间配置（可编辑），右栏 = 目标命名空间配置（可编辑，初始已按规则填充）
 * - 挂载后 Monaco model 为唯一事实源，仅通过 onDidChangeModelContent 回读到 store
 * - 自动合并：右侧 = applyRules(左侧当前内容)，即同步左侧增删行 + 应用替换规则
 */
export function DiffView(): React.ReactElement {
  const { message } = App.useApp()
  const selectedKey = useAppStore((s) => s.selectedKey)
  const rows = useAppStore((s) => s.rows)
  const rules = useAppStore((s) => s.rules)
  const updateLeft = useAppStore((s) => s.updateLeft)
  const updateRight = useAppStore((s) => s.updateRight)
  const setMergeWarnings = useAppStore((s) => s.setMergeWarnings)
  const publish = usePublish()

  const row = rows.find((r) => r.key === selectedKey) ?? null

  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const initialRef = useRef<{ key: string; left: string; right: string } | null>(null)
  const [detectState, setDetectState] = useState<{ open: boolean; candidates: RuleCandidate[] }>({
    open: false,
    candidates: []
  })

  // 按配置捕获初始内容：切换配置时重挂载（DiffEditor key=row.key），期间保持不变，
  // 避免 store 回写触发 DiffEditor 的 setValue 重置光标/undo
  if (row && initialRef.current?.key !== row.key) {
    initialRef.current = { key: row.key, left: row.leftBuffer, right: row.rightBuffer }
  }
  if (!row) {
    initialRef.current = null
  }

  // 外部引起的缓冲区变化（保存规则后重算等）同步回编辑器
  useEffect(() => {
    const ed = editorRef.current
    if (!ed || !row) return
    const orig = ed.getOriginalEditor()
    const mod = ed.getModifiedEditor()
    if (orig.getValue() !== row.leftBuffer) orig.setValue(row.leftBuffer)
    if (mod.getValue() !== row.rightBuffer) mod.setValue(row.rightBuffer)
  })

  if (!row || !initialRef.current) {
    return (
      <div className="right-panel-empty">
        <Empty description="请选择左侧配置开始对比" />
      </div>
    )
  }

  const init = initialRef.current
  const rowKey = row.key

  const onMount = (ed: monaco.editor.IStandaloneDiffEditor): void => {
    editorRef.current = ed
    const orig = ed.getOriginalEditor()
    const mod = ed.getModifiedEditor()
    orig.onDidChangeModelContent(() => updateLeft(rowKey, orig.getValue()))
    mod.onDidChangeModelContent(() => updateRight(rowKey, mod.getValue()))
  }

  /** 跳转到上/下一处差异（monaco 0.5x 移除了 createDiffNavigator，基于 getLineChanges 自行实现）。 */
  const gotoChange = (dir: 1 | -1): void => {
    const ed = editorRef.current
    if (!ed) return
    const changes = ed.getLineChanges()
    if (!changes || changes.length === 0) {
      message.info('没有更多差异')
      return
    }
    const mod = ed.getModifiedEditor()
    const curLine = mod.getPosition()?.lineNumber ?? 1
    const startOf = (c: monaco.editor.ILineChange): number =>
      Math.max(1, c.modifiedStartLineNumber || c.originalStartLineNumber)

    let idx = -1
    if (dir === 1) {
      idx = changes.findIndex((c) => startOf(c) > curLine)
      if (idx === -1) idx = 0 // 环绕到第一处
    } else {
      for (let i = changes.length - 1; i >= 0; i--) {
        if (startOf(changes[i]) < curLine) {
          idx = i
          break
        }
      }
      if (idx === -1) idx = changes.length - 1 // 环绕到最后一处
    }

    const line = startOf(changes[idx])
    mod.revealLineInCenter(line)
    mod.setPosition({ lineNumber: line, column: 1 })
    mod.focus()
  }

  /** 自动检测替换规则：比较左右当前内容，把值差异归纳为候选规则。 */
  const detect = (): void => {
    if (!row) return
    const res = detectRuleCandidates(row.leftBuffer, row.rightBuffer, row.type, row.dataId)
    if (res.candidates.length === 0) {
      if (res.warnings.length > 0) message.warning(res.warnings[0])
      else message.info('未检测到可转换为替换规则的值差异')
      return
    }
    setDetectState({ open: true, candidates: res.candidates })
  }

  const autoMerge = (): void => {
    const ed = editorRef.current
    if (!ed) return
    const leftText = ed.getOriginalEditor().getValue()
    const { content, warnings } = applyRules(leftText, row.type, row.dataId, rules)
    ed.getModifiedEditor().setValue(content) // 触发回读 → store 更新 → 状态重算、重新 diff
    setMergeWarnings(row.key, warnings)
    if (warnings.length > 0) {
      message.warning(`自动合并完成，有 ${warnings.length} 条规则警告，请查看警告栏`)
    } else {
      message.success('自动合并完成：左侧增删已同步到右侧，并已按规则填充')
    }
  }

  return (
    <>
      <div className="diff-header">
        <span className="diff-header-title">{row.dataId}</span>
        <span className="diff-header-sub">group: {row.group}</span>
        <StatusBadge row={row} />
        <div style={{ flex: 1 }} />
        <Space size={4}>
          <Button size="small" onClick={() => gotoChange(-1)}>
            上一处差异
          </Button>
          <Button size="small" onClick={() => gotoChange(1)}>
            下一处差异
          </Button>
        </Space>
      </div>

      {row.previewWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ margin: '8px 12px 0' }}
          message="规则警告"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {row.previewWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      <div className="diff-editor-wrap">
        <DiffEditor
          key={row.key}
          original={init.left}
          modified={init.right}
          language={monacoLanguage(row.type, row.dataId)}
          theme="vs"
          options={{
            renderSideBySide: true,
            originalEditable: true,
            // 左右两栏永远自动等分宽度，禁止拖拽分栏改变比例
            enableSplitViewResizing: false,
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true
          }}
          onMount={onMount}
        />
      </div>

      <div className="diff-footer">
        <Button onClick={autoMerge}>自动合并</Button>
        <Button onClick={detect}>自动检测替换规则</Button>
        <Button type="primary" danger onClick={() => publish(row.key)}>
          确认发布
        </Button>
        <span className="diff-footer-status">
          自动合并 = 把左侧增删行同步到右侧并按目标命名空间规则填充；自动检测 = 把左右值差异归纳成替换规则；确认发布 = 将右侧内容发布到目标命名空间
        </span>
      </div>
      <DetectRulesModal
        open={detectState.open}
        dataId={row.dataId}
        candidates={detectState.candidates}
        onClose={() => setDetectState((d) => ({ ...d, open: false }))}
      />
    </>
  )
}
