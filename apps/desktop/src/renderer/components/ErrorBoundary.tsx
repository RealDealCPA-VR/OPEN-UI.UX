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
        <div role="alert" className="error-boundary-fallback">
          <h2>A part of the interface couldn&apos;t load</h2>
          {this.props.label ? <p>In {this.props.label}</p> : null}
          <pre className="tool-card-pre">
            <code>{this.state.error.message}</code>
          </pre>
          <button type="button" className="btn" onClick={this.reset}>
            Reload this view
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
