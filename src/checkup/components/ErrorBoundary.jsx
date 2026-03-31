import { createElement as h, Component } from 'react'
import { captureClientDiagnostic } from '../lib/runtimeLogger.js'
import { C } from '../theme.js'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      diagnosticId: null,
    }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    const diagnostic = captureClientDiagnostic('error-boundary', error, {
      scope: this.props.scope || null,
      title: this.props.title || null,
      componentStack: errorInfo?.componentStack || null,
    })
    this.setState({ error, errorInfo, diagnosticId: diagnostic.id })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, diagnosticId: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.title || '這個區塊'
    const description = this.props.description || '這個區塊暫時發生錯誤，其他功能仍可繼續使用。'
    const actionLabel = this.props.actionLabel || '重試區塊'
    const containerStyle = {
      padding: '20px',
      background: C.card,
      border: `2px solid ${C.down}`,
      borderRadius: 10,
      margin: 0,
      ...this.props.style,
    }

    return h(
      'div',
      { style: containerStyle },
      h('h2', { style: { color: C.down, marginBottom: 10 } }, `${title} 發生錯誤`),
      h('p', { style: { color: C.text, marginBottom: 10 } }, description),
      h(
        'details',
        { style: { color: C.textMute, fontSize: 10, whiteSpace: 'pre-wrap' } },
        h('summary', { style: { cursor: 'pointer', marginBottom: 5 } }, '查看錯誤詳情'),
        h(
          'div',
          null,
          this.state.diagnosticId ? `診斷編號：${this.state.diagnosticId}\n\n` : '',
          this.state.error?.toString(),
          '\n\n',
          this.state.errorInfo?.componentStack
        )
      ),
      h(
        'button',
        {
          onClick: this.handleReset,
          style: {
            marginTop: 15,
            padding: '10px 20px',
            background: C.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          },
        },
        actionLabel
      )
    )
  }
}
