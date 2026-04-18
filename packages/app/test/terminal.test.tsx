import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TerminalPanel } from '../src/panels/TerminalPanel.js';
import { useCliStore } from '../src/store/cliStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';

// Mock the Tauri-backed CLI service so the empty-state flow can be exercised
// without the backend.
vi.mock('../src/services/cli.js', () => ({
  registerCli: vi.fn(async () => 'added'),
  spawnCli: vi.fn(async () => undefined),
  sendStdin: vi.fn(async () => undefined),
  resizeCli: vi.fn(async () => undefined),
  shutdownCli: vi.fn(async () => undefined),
  getDefaultSessionPath: vi.fn(async () => '/tmp/drawcast-session'),
  subscribeCliOutput: vi.fn(() => () => undefined),
  subscribeCliExit: vi.fn(() => () => undefined),
}));

import {
  registerCli,
  spawnCli,
} from '../src/services/cli.js';

describe('TerminalPanel empty state', () => {
  beforeEach(() => {
    act(() => {
      useCliStore.setState({ running: false, which: null });
      useSessionStore.setState({ id: null, path: '/tmp/drawcast-session' });
      useSettingsStore.setState({
        themeMode: 'light',
        cliChoice: null,
        panelRatio: 0.4,
      });
    });
    vi.mocked(registerCli).mockClear();
    vi.mocked(spawnCli).mockClear();
    vi.mocked(registerCli).mockResolvedValue('added');
    vi.mocked(spawnCli).mockResolvedValue(undefined);
  });

  it('renders the "Connect CLI" button disabled until a CLI is picked', () => {
    render(<TerminalPanel />);
    const button = screen.getByTestId('dc-terminal-connect') as HTMLButtonElement;
    expect(button).toBeInTheDocument();
    expect(button.disabled).toBe(true);

    act(() => {
      useSettingsStore.getState().setCliChoice('claude-code');
    });
    expect(
      (screen.getByTestId('dc-terminal-connect') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('registers the CLI and spawns it when Connect CLI is clicked', async () => {
    act(() => {
      useSettingsStore.getState().setCliChoice('claude-code');
    });
    render(<TerminalPanel />);
    const button = screen.getByTestId('dc-terminal-connect');
    fireEvent.click(button);

    await waitFor(() => {
      expect(registerCli).toHaveBeenCalledWith('claude-code');
    });
    await waitFor(() => {
      expect(spawnCli).toHaveBeenCalledWith(
        'claude-code',
        '/tmp/drawcast-session',
      );
    });
    // Empty-state UI updates the cliStore via the `onAttached` callback,
    // which swaps the panel to the xterm host. Verify the store is updated.
    await waitFor(() => {
      expect(useCliStore.getState().running).toBe(true);
      expect(useCliStore.getState().which).toBe('claude-code');
    });
  });
});
