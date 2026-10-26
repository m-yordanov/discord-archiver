import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback: (error: Error, reset: () => void) => ReactNode;
  resetKey?: unknown;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    return Object.is(props.resetKey, state.resetKey) ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

interface CrashPanelProps {
  title: string;
  error: Error;
  actionLabel: string;
  onAction: () => void;
}

export function CrashPanel({ title, error, actionLabel, onAction }: CrashPanelProps) {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 bg-dc-darkest text-dc-text-muted p-6 text-center">
      <span className="text-2xl">⚠️</span>
      <span className="text-white font-semibold">{title}</span>
      <code className="max-w-xl text-xs bg-dc-dark border border-dc-input/60 rounded px-3 py-2 break-words select-text">
        {error.message || error.name}
      </code>
      <button
        type="button"
        onClick={onAction}
        className="px-3 py-1.5 rounded text-xs bg-dc-accent hover:brightness-110 text-white cursor-pointer"
      >
        {actionLabel}
      </button>
    </div>
  );
}
