import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Top-level error boundary that prevents the entire React tree from
 * unmounting on an unhandled error.  Without this, any thrown error
 * in a child component would leave the user with a blank screen
 * (only the CSS background visible).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error in React tree:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const message =
        this.state.error?.message ?? "An unexpected error occurred.";

      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
          <div className="flex size-20 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="size-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-2xl font-black uppercase tracking-tight text-white">
              Something went wrong
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              An unexpected error caused the application to crash. You can try
              resetting the view or reloading the app.
            </p>
            <p className="font-mono text-xs text-destructive/80 break-words">
              {message}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Try Again
            </button>
            <button
              onClick={this.handleReload}
              className="h-10 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}