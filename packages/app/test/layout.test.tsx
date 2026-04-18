import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { App } from '../src/App.js';
import { useCliStore } from '../src/store/cliStore.js';
import { useSidecarStore } from '../src/store/sidecarStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';

describe('App layout', () => {
  beforeEach(() => {
    // Reset stores to defaults between tests so order doesn't matter.
    act(() => {
      useSidecarStore.setState({
        status: 'starting',
        port: null,
        lastExitCode: null,
      });
      useSettingsStore.setState({
        themeMode: 'light',
        cliChoice: null,
        panelRatio: 0.4,
      });
      useCliStore.setState({ running: false, which: null });
    });
  });

  it('renders the TopBar with the Drawcast title', () => {
    render(<App />);
    expect(screen.getByText('Drawcast')).toBeInTheDocument();
  });

  it('shows the splitter, the terminal empty state, and the canvas panel', () => {
    render(<App />);
    expect(screen.getByTestId('dc-splitter')).toBeInTheDocument();
    // PR #14 replaced the terminal placeholder with the xterm.js host. When
    // no CLI is attached, the empty state shows the "Drop to attach" heading
    // and the Connect CLI button.
    expect(screen.getByTestId('dc-terminal-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dc-terminal-connect')).toBeInTheDocument();
    // PR #13 replaced the CanvasPlaceholder with the real panel, so the
    // test now asserts on the panel container and the mocked Excalidraw.
    expect(screen.getByTestId('dc-canvas-panel')).toBeInTheDocument();
    expect(screen.getByTestId('excalidraw-mock')).toBeInTheDocument();
  });

  it('shows "Starting…" while the sidecar has no port, and "MCP :43017" when ready', () => {
    render(<App />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();

    act(() => {
      useSidecarStore.getState().setReady(43017);
    });
    expect(screen.getByText('MCP :43017')).toBeInTheDocument();
  });

  it('renders the CLI badge alongside the MCP status', () => {
    render(<App />);
    const badge = screen.getByTestId('dc-cli-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent ?? '').toContain('No CLI');

    act(() => {
      useCliStore.getState().setRunning(true, 'claude-code');
    });
    expect(screen.getByTestId('dc-cli-badge').textContent ?? '').toContain(
      'Claude Code',
    );
  });
});
