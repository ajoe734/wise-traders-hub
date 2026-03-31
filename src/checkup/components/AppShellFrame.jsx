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
        fontFamily: "'Inter','Noto Sans TC',system-ui,sans-serif",
        paddingBottom: 40,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        /* Global styles moved to a separate CSS file or a dedicated style component if needed */
      `}</style>

      <ErrorBoundary
        scope="header"
        title={headerBoundaryCopy.title}
        description={headerBoundaryCopy.description}
      >
        <Header {...headerProps} />
      </ErrorBoundary>

      <div className="app-shell" style={{ padding: '10px 14px' }}>
        <PortfolioPanelsProvider data={panelsData} actions={panelsActions}>
          <AppPanels {...panelsProps} />
        </PortfolioPanelsProvider>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  )
}

