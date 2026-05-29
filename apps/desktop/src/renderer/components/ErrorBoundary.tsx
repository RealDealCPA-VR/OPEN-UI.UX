import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.label ?? 'ErrorBoundary';
    console.error(`[${label}] caught render error`, error, info);
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div
          role="alert"
          style={{
            padding: 16,
            margin: 16,
            border: '1px solid var(--danger-border, #b00020)',
            background: 'var(--danger-bg, #2a1010)',
            color: 'var(--text-primary, #fff)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <h2 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Something went wrong</h2>
          <p style={{ margin: '0 0 8px 0', opacity: 0.85 }}>
            {this.props.label ? `In ${this.props.label}: ` : null}
            {this.state.error.message}
          </p>
          <button type="button" className="btn" onClick={this.reset} style={{ marginTop: 4 }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
