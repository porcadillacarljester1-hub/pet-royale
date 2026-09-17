import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Caught by ErrorBoundary:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-6">
        <div className="workspace-card w-full max-w-[440px] rounded-[28px] p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)]">
            <AlertTriangle size={24} className="text-[hsl(var(--destructive))]" />
          </div>

          <h1 className="display-face mt-5 text-[26px] leading-none">
            Something went wrong
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            This screen couldn&apos;t load. Reloading usually fixes it — nothing
            you&apos;ve saved is affected.
          </p>

          <button
            onClick={this.handleReload}
            className="mx-auto mt-6 flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))]"
          >
            <RotateCcw size={16} /> Reload
          </button>

          {/* Only in development. A stack trace tells a receptionist
              nothing and looks alarming; it tells a developer
              everything. */}
          {import.meta.env.DEV && (
            <pre className="mt-6 max-h-40 overflow-auto rounded-xl bg-[hsl(var(--muted))] p-3 text-left text-[11px] text-[hsl(var(--muted-foreground))]">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
