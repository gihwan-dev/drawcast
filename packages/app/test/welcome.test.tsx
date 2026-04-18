// Welcome overlay regression tests (PR #22). Covers the three paths the
// first-run flow needs to handle cleanly:
//   1. It renders when the user has neither dismissed it nor picked a CLI.
//   2. Picking a CLI + Connect walks through registerCli → spawnCli and
//      persists the choice in settingsStore.
//   3. "Load sample session" seeds sceneStore with the three sample
//      primitives — verified by count and by the compile pipeline not
//      producing warnings on the resulting L2 input.

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { compile } from '@drawcast/core';
import type { Primitive } from '@drawcast/core';
import { Welcome } from '../src/pages/Welcome.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useWelcomeStore } from '../src/store/welcomeStore.js';
import { useSceneStore } from '../src/store/sceneStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { resolveBuiltinTheme } from '../src/theme/builtinThemes.js';

// Mock the Tauri service so the test can drive the happy path without
// a running sidecar / Rust backend.
vi.mock('../src/services/cli.js', () => ({
  registerCli: vi.fn(async () => 'added'),
  spawnCli: vi.fn(async () => undefined),
  checkCliInstalled: vi.fn(async () => true),
  // Unused here but re-exported so any transitive consumer doesn't blow up.
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
  checkCliInstalled,
} from '../src/services/cli.js';

function resetStores(): void {
  act(() => {
    useWelcomeStore.setState({ dismissed: false });
    useSettingsStore.setState({
      themeMode: 'light',
      cliChoice: null,
      panelRatio: 0.4,
    });
    useSessionStore.setState({
      id: null,
      path: '/tmp/drawcast-session',
      current: null,
      list: [],
    });
    useSceneStore.getState().reset();
  });
  vi.mocked(registerCli).mockClear();
  vi.mocked(spawnCli).mockClear();
  vi.mocked(checkCliInstalled).mockClear();
  vi.mocked(registerCli).mockResolvedValue('added');
  vi.mocked(spawnCli).mockResolvedValue(undefined);
  vi.mocked(checkCliInstalled).mockResolvedValue(true);
}

describe('Welcome overlay', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders when not dismissed and no CLI is chosen', () => {
    render(<Welcome />);
    expect(screen.getByTestId('dc-welcome')).toBeInTheDocument();
    // Connect CTA should start disabled — no CLI selected yet.
    const cta = screen.getByTestId('dc-welcome-connect') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('calls registerCli then spawnCli when a CLI is picked and Connect is clicked', async () => {
    render(<Welcome />);

    // Pick Claude Code — the Rust detection should be probed exactly once.
    fireEvent.click(screen.getByTestId('dc-welcome-option-claude-code'));
    await waitFor(() => {
      expect(checkCliInstalled).toHaveBeenCalledWith('claude-code');
    });

    const cta = screen.getByTestId('dc-welcome-connect') as HTMLButtonElement;
    await waitFor(() => {
      expect(cta.disabled).toBe(false);
    });

    fireEvent.click(cta);

    await waitFor(() => {
      expect(registerCli).toHaveBeenCalledWith('claude-code');
    });
    await waitFor(() => {
      expect(spawnCli).toHaveBeenCalledWith(
        'claude-code',
        '/tmp/drawcast-session',
      );
    });
    // registerCli must run before spawnCli — assert ordering via the
    // mock invocation index.
    const registerOrder = vi.mocked(registerCli).mock.invocationCallOrder[0];
    const spawnOrder = vi.mocked(spawnCli).mock.invocationCallOrder[0];
    expect(registerOrder).toBeDefined();
    expect(spawnOrder).toBeDefined();
    expect(registerOrder!).toBeLessThan(spawnOrder!);
    // Side-effects: cliChoice persisted + overlay dismissed.
    await waitFor(() => {
      expect(useSettingsStore.getState().cliChoice).toBe('claude-code');
    });
    expect(useWelcomeStore.getState().dismissed).toBe(true);
  });

  it('"Load sample session" seeds sceneStore with three primitives that compile cleanly', () => {
    render(<Welcome />);
    fireEvent.click(screen.getByTestId('dc-welcome-sample'));

    const scene = useSceneStore.getState();
    expect(scene.primitives.length).toBe(3);
    const kinds = scene.primitives.map((p: Primitive) => p.kind).sort();
    expect(kinds).toEqual(['connector', 'labelBox', 'labelBox']);

    // Compile the sample through the real pipeline to prove the L2 input
    // is valid — no warnings, no errors. This doubles as a smoke test for
    // the sample loader's primitive shape.
    const result = compile({
      primitives: new Map(scene.primitives.map((p) => [p.id, p])),
      theme: resolveBuiltinTheme(scene.theme),
    });
    expect(result.warnings).toEqual([]);
    expect(result.elements.length).toBeGreaterThan(0);
  });

  it('Skip for now dismisses the overlay without touching cliChoice', () => {
    render(<Welcome />);
    fireEvent.click(screen.getByTestId('dc-welcome-skip'));
    expect(useWelcomeStore.getState().dismissed).toBe(true);
    expect(useSettingsStore.getState().cliChoice).toBe(null);
  });
});
