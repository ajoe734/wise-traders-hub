import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { captureClientDiagnostic, getClientSessionId } from '@/checkup/lib/runtimeLogger.js';
import { isStaleChunkError } from '@/lib/staleChunkRecovery';

type Props = { children: ReactNode; signalId?: string | null };
type State = { error: Error | null; diagnosticId: string | null; sessionId: string | null };

/**
 * 專門包 SignalDetail 的錯誤邊界：即使 experts 資料結構異常（缺 currency、
 * 缺 experts 巢狀物件、instrument 為 null 等）或 render 中拋錯，也只會顯示
 * 這張 Card，不會炸掉整個 /app 佈局。錯誤同時走 captureClientDiagnostic
 * 進入診斷管線，可在 /company/function-logs 追。
 */
export class SignalDetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null, diagnosticId: null, sessionId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleChunkError(error)) return;
    try {
      const entry = captureClientDiagnostic('signal-detail-error-boundary', error, {
        signalId: this.props.signalId ?? null,
        componentStack: info?.componentStack ?? null,
        href: typeof window !== 'undefined' ? window.location.href : null,
      });
      this.setState({
        diagnosticId: entry?.id ?? null,
        sessionId: entry?.sessionId ?? getClientSessionId(),
      });
    } catch {
      // never let diagnostics break the fallback
    }
  }

  private handleRetry = () => {
    this.setState({ error: null, diagnosticId: null, sessionId: null });
  };

  private handleBack = () => {
    if (typeof window !== 'undefined') {
      if (window.history.length > 1) window.history.back();
      else window.location.assign('/app/signals');
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6 py-10">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-4 text-center">
            <div className="flex justify-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-lg font-medium text-foreground">訊號內容暫時無法顯示</h1>
            <p className="text-sm text-muted-foreground">
              這則訊號的教學欄位或資料結構有異常，我們已自動回報。您可以重試，或返回訊號列表。
            </p>
            {this.state.diagnosticId ? (
              <p className="text-xs text-muted-foreground/80">診斷編號：{this.state.diagnosticId}</p>
            ) : null}
            {this.state.sessionId ? (
              <p className="text-xs text-muted-foreground/80">會話編號：{this.state.sessionId}</p>
            ) : null}
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button type="button" variant="outline" onClick={this.handleBack}>
                <ArrowLeft className="h-4 w-4 mr-1" />返回列表
              </Button>
              <Button type="button" onClick={this.handleRetry}>
                <RefreshCw className="h-4 w-4 mr-1" />重試
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}
