import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isStaleChunkError, reloadForFreshBundle } from "@/lib/staleChunkRecovery";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  isChunkError: boolean;
};

export class RouteChunkBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    isChunkError: false,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      isChunkError: isStaleChunkError(error),
    };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    if (isStaleChunkError(error)) {
      reloadForFreshBundle();
    }
  }

  handleRetry = () => {
    reloadForFreshBundle();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (!this.state.isChunkError) {
      throw this.state.error;
    }

    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="space-y-2">
            <h1 className="text-xl font-medium text-foreground">正在更新頁面資源</h1>
            <p className="text-sm text-muted-foreground">
              偵測到頁面版本已更新，重新整理後會自動載入最新內容。
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            <Button type="button" variant="outline" onClick={this.handleRetry}>
              立即重整
            </Button>
          </div>
        </div>
      </div>
    );
  }
}