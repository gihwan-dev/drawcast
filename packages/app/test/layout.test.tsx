import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { App } from '../src/App.js';
import { useChatStore } from '../src/store/chatStore.js';
import { useSidecarStore } from '../src/store/sidecarStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useWelcomeStore } from '../src/store/welcomeStore.js';

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
        panelRatio: 0.4,
      });
      useChatStore.getState().reset();
      // Dismiss the first-run overlay so the test mounts the workspace
      // directly — the Welcome surface has its own dedicated spec.
      useWelcomeStore.setState({ dismissed: true });
    });
  });

  it('renders the TopBar with the Drawcast title', () => {
    render(<App />);
    expect(screen.getByText('Drawcast')).toBeInTheDocument();
  });

  it('shows the splitter, the chat panel, and the canvas panel', () => {
    render(<App />);
    expect(screen.getByTestId('dc-splitter')).toBeInTheDocument();
    expect(screen.getByTestId('dc-chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('dc-chat-composer')).toBeInTheDocument();
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

  it('renders the chat badge with idle/ready transitions', () => {
    render(<App />);
    const badge = screen.getByTestId('dc-chat-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent ?? '').toContain('Claude idle');

    act(() => {
      useChatStore.getState().handleEvent({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        model: 'claude-sonnet-4-6',
        apiKeySource: 'none',
      });
    });
    expect(screen.getByTestId('dc-chat-badge').textContent ?? '').toContain(
      'Claude ready',
    );
  });
});
