import { useEffect } from 'react'
import { ConfigTable } from './components/ConfigTable'
import { DiffView } from './components/DiffView'
import { NamespacePanel } from './components/NamespacePanel'
import { RulesModal } from './components/RulesModal'
import { SettingsModal } from './components/SettingsModal'
import { TopBar } from './components/TopBar'
import { useAppStore } from './store/app-store'

export default function App(): React.JSX.Element {
  const init = useAppStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app-root">
      <TopBar />
      <div className="app-body">
        <div className="left-panel">
          <NamespacePanel />
          <div className="left-panel-scroll">
            <ConfigTable />
          </div>
        </div>
        <div className="right-panel">
          <DiffView />
        </div>
      </div>
      <SettingsModal />
      <RulesModal />
    </div>
  )
}
