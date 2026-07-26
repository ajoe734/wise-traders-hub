/**
 * @deprecated Legacy shell — 未在 runtime 路由中使用。
 * 現行架構走 PortfolioLayout + per-route pages（見 docs/architecture/holdings-modules.md）。
 * 請勿在此檔新增功能；清理排程於同文件「Legacy Dead Code」章節。
 */
import { C } from '../theme.js'
import AppPanels from './AppPanels.jsx'
import { ConfirmDialog } from './common/index.js'
import Header from './Header.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { PortfolioPanelsProvider } from '../contexts/PortfolioPanelsContext.jsx'

export default function AppShellFrame({
  ready,
  loadingMessage,
  headerBoundaryCopy,
  headerProps,
  panelsData,
  panelsActions,
  panelsProps,
  confirmDialogProps,
}) {
  if (!ready) {
    return (
      <div
        style={{
          background: C.bg,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.textMute,
          fontFamily: 'sans-serif',
          fontSize: 13,
        }}
      >
        {loadingMessage}
      </div>
    )
  }

  return (
    <div
      style={{
        background: C.bg,
        minHeight: '100vh',
        color: C.text,
        fontFamily: 'var(--cm-font-sans)',
        paddingBottom: 40,
      }}
    >
      <ErrorBoundary
        scope="header"
        title={headerBoundaryCopy.title}
        description={headerBoundaryCopy.description}
      >
        <Header {...headerProps} />
      </ErrorBoundary>

      <div className="app-shell cm-shell-inner">
        <PortfolioPanelsProvider data={panelsData} actions={panelsActions}>
          <AppPanels {...panelsProps} />
        </PortfolioPanelsProvider>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  )
}

