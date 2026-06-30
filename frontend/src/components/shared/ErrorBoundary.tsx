import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';
import { isChunkLoadError, reloadOnceForChunkError } from '../../lib/chunkReload';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  reloading: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    reloading: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    // For a stale-chunk error we expect to reload (see componentDidCatch), so
    // render the "Updating…" splash instead of flashing the error card first.
    return {
      hasError: true,
      error,
      errorInfo: null,
      reloading: isChunkLoadError(error),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // A code-split chunk went missing because a newer bundle was deployed.
      // Reload once to fetch the fresh index.html + asset hashes. If the reload
      // is suppressed by the loop guard, fall back to the normal error card.
      const reloading = reloadOnceForChunkError();
      this.setState({ errorInfo, reloading });
      return;
    }

    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, reloading: false });
  };

  public render() {
    if (this.state.hasError) {
      // A reload is in flight for a stale-chunk error: show a calm splash rather
      // than the error card, since the page is about to navigate away anyway.
      if (this.state.reloading) {
        return (
          <div className="min-h-[400px] flex items-center justify-center p-8">
            <div className="flex items-center gap-3 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Updating to the latest version…</span>
            </div>
          </div>
        );
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              An unexpected error occurred. Please try again or contact support if the problem persists.
            </p>
            {this.state.error && (
              <div className="mb-4 p-4 bg-muted rounded-lg text-left">
                <p className="text-sm font-mono text-destructive">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <Button onClick={this.handleRetry} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
