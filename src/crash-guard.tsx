import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { title: string; hint: string; children: ReactNode };

/** Keeps a render failure from blanking the window: it says what happened and offers a way back. Saved designs are untouched by it. */
export class CrashGuard extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>{this.props.title}</h2>
        <p>{this.props.hint}</p>
        <code className="crash-detail">{error.message}</code>
        <div className="crash-actions">
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              // The address and the last-opened note both name the design, so a plain reload lands on the same failure.
              try {
                localStorage.removeItem('sd-last');
              } catch {
                // Blocked storage has nothing to forget.
              }
              location.hash = '';
              location.reload();
            }}
          >
            Leave this design
          </button>
          <button type="button" className="btn ink" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
