import { Trans } from '@lingui/react/macro'
import { Component, type ReactNode } from 'react'

/**
 * Catches a screen that fails to draw, so one bad entry in a group can't
 * blank the whole app. Keyed by the route in App, so moving elsewhere
 * tries again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('screen', error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="screen">
        <div className="card">
          <h2>
            <Trans>This screen couldn’t be shown</Trans>
          </h2>
          <p className="muted">
            <Trans>Something in it didn’t look right. Your groups and keys are safe on this phone.</Trans>
          </p>
          <a className="button" href="#/">
            <Trans>Go to your groups</Trans>
          </a>
        </div>
      </main>
    )
  }
}
