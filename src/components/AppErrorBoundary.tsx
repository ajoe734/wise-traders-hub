import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { captureClientDiagnostic } from "@/checkup/lib/runtimeLogger.js";
import { isStaleChunkError } from "@/lib/staleChunkRecovery";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  diagnosticId: string | null;
};

/**
 * Top-level boundary that catches any uncaught render error from the
 * portal/app/admin/company/checkup routes (RouteChunkBoundary re-throws
 * anything that isn't a stale-chunk error). Reports the error through the
 * same diagnostics pipeline used by window.error / unhandledrejection so the
 * incident shows up in /company/function-logs and Sentry (when enabled).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, diagnosticId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, diagnosticId: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Stale chunk errors are handled by RouteChunkBoundary; ignore here.
    if (isStaleChunkError(error)) return;
    try {
      const entry = captureClientDiagnostic("app-error-boundary", error, {
        componentStack: errorInfo?.componentStack || null,
        href: typeof window !== "undefined" ? window.location.href : null,
      });
      this.setState({ diagnosticId: entry?.id ?? null });
    } catch {
      // diagnostics must never break the fallback render
    }
  }

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  handleHome = () => {
    if (typeof window !== "undefined") window.location.assign("/");
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md space-y-5 text-center">
          <h1 className="text-xl font-medium text-foreground">頁面發生錯誤</h1>
          <p className="text-sm text-muted-foreground">
            很抱歉，此頁面遇到非預期錯誤。已自動回報，您可以重新整理或回到首頁。
          </p>
          {this.state.diagnosticId ? (
            <p className="text-xs text-muted-foreground/80">
              診斷編號：{this.state.diagnosticId}
            </p>
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <Button type="button" variant="outline" onClick={this.handleHome}>
              回到首頁
            </Button>
            <Button type="button" onClick={this.handleReload}>
              重新整理
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
