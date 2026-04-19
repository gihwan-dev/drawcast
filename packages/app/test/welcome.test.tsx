// Welcome overlay regression tests. The pre-chat flow asked users to pick
// Claude Code vs Codex and then registered MCP config in their home dir.
// The current flow is much simpler:
//
//   1. Overlay renders until the user explicitly dismisses it.
//   2. A "Start chatting" button is disabled when `claude` isn't on PATH
//      and enabled once detection succeeds.
//   3. Clicking "Load sample session" seeds sceneStore with the stock
//      sample primitives and they must compile without warnings.
//   4. "Skip for now" dismisses the overlay without any side effects.

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { compile } from '@drawcast/core';
import type { Primitive } from '@drawcast/core';
import { Welcome } from '../src/pages/Welcome.js';
import { useWelcomeStore } from '../src/store/welcomeStore.js';
import { useSceneStore } from '../src/store/sceneStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { resolveBuiltinTheme } from '../src/theme/builtinThemes.js';

vi.mock('../src/services/chat.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/services/chat.js')>(
      '../src/services/chat.js',
    );
  return {
    ...actual,
    checkClaudeInstalled: vi.fn(async () => true),
  };
});

import { checkClaudeInstalled } from '../src/services/chat.js';

function resetStores(): void {
  act(() => {
    useWelcomeStore.setState({ dismissed: false });
    useSessionStore.setState({
      id: null,
      path: '/tmp/drawcast-session',
      current: null,
      list: [],
    });
    useSceneStore.getState().reset();
  });
  vi.mocked(checkClaudeInstalled).mockClear();
  vi.mocked(checkClaudeInstalled).mockResolvedValue(true);
}

describe('Welcome overlay', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders until the user dismisses it', () => {
    render(<Welcome />);
    expect(screen.getByTestId('dc-welcome')).toBeInTheDocument();
  });

  it('enables Start chatting when `claude` is detected', async () => {
    render(<Welcome />);
    await waitFor(() => {
      expect(checkClaudeInstalled).toHaveBeenCalled();
    });
    const cta = await screen.findByTestId('dc-welcome-start');
    await waitFor(() => {
      expect((cta as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('disables Start chatting when `claude` is missing and surfaces the install hint', async () => {
    vi.mocked(checkClaudeInstalled).mockResolvedValue(false);
    render(<Welcome />);
    await waitFor(() => {
      expect(
        screen.getByTestId('dc-welcome-detect-missing'),
      ).toBeInTheDocument();
    });
    const cta = screen.getByTestId('dc-welcome-start') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('"Start chatting" dismisses the overlay', async () => {
    render(<Welcome />);
    const cta = await screen.findByTestId('dc-welcome-start');
    await waitFor(() => {
      expect((cta as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(cta);
    expect(useWelcomeStore.getState().dismissed).toBe(true);
  });

  it('"Load sample session" seeds sceneStore with three primitives that compile cleanly', () => {
    render(<Welcome />);
    fireEvent.click(screen.getByTestId('dc-welcome-sample'));

    const scene = useSceneStore.getState();
    expect(scene.primitives.length).toBe(3);
    const kinds = scene.primitives.map((p: Primitive) => p.kind).sort();
    expect(kinds).toEqual(['connector', 'labelBox', 'labelBox']);

    const result = compile({
      primitives: new Map(scene.primitives.map((p) => [p.id, p])),
      theme: resolveBuiltinTheme(scene.theme),
    });
    expect(result.warnings).toEqual([]);
    expect(result.elements.length).toBeGreaterThan(0);
  });

  it('Skip for now dismisses the overlay', () => {
    render(<Welcome />);
    fireEvent.click(screen.getByTestId('dc-welcome-skip'));
    expect(useWelcomeStore.getState().dismissed).toBe(true);
  });
});
