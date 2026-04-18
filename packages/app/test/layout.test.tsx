import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { App } from '../src/App.js';
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
    });
  });

  it('renders the TopBar with the Drawcast title', () => {
    render(<App />);
    expect(screen.getByText('Drawcast')).toBeInTheDocument();
  });

  it('shows the splitter separator and both placeholder panels', () => {
    render(<App />);
    expect(screen.getByTestId('dc-splitter')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Canvas')).toBeInTheDocument();
  });

  it('shows "Starting…" while the sidecar has no port, and "MCP :43017" when ready', () => {
    render(<App />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();

    act(() => {
      useSidecarStore.getState().setReady(43017);
    });
    expect(screen.getByText('MCP :43017')).toBeInTheDocument();
  });
});
