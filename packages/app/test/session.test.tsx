import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SessionSelect } from '../src/components/SessionSelect.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import type { SessionMeta } from '../src/services/session.js';

// Mock the Tauri-backed session service so tests can exercise the store and
// component without the backend.
vi.mock('../src/services/session.js', () => ({
  getCurrentSession: vi.fn(async () => null),
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'new',
    name: 'New',
    createdAt: 0,
    updatedAt: 0,
    cliChoice: null,
    theme: 'sketchy',
    lastKnownPort: null,
  })),
  switchSession: vi.fn(async () => ({
    id: 'work',
    name: 'Work',
    createdAt: 0,
    updatedAt: 0,
    cliChoice: null,
    theme: 'sketchy',
    lastKnownPort: null,
  })),
  subscribeSessionSwitched: vi.fn(() => () => undefined),
}));

import {
  getCurrentSession,
  listSessions,
  switchSession,
} from '../src/services/session.js';

const DEFAULT_META: SessionMeta = {
  id: 'default',
  name: 'Default',
  createdAt: 100,
  updatedAt: 100,
  cliChoice: null,
  theme: 'sketchy',
  lastKnownPort: null,
};

const WORK_META: SessionMeta = {
  id: 'work',
  name: 'Work',
  createdAt: 200,
  updatedAt: 200,
  cliChoice: null,
  theme: 'sketchy',
  lastKnownPort: null,
};

describe('sessionStore', () => {
  beforeEach(() => {
    act(() => {
      useSessionStore.setState({
        id: null,
        path: null,
        current: null,
        list: [],
      });
    });
    vi.mocked(getCurrentSession).mockClear();
    vi.mocked(listSessions).mockClear();
    vi.mocked(switchSession).mockClear();
    vi.mocked(getCurrentSession).mockResolvedValue(DEFAULT_META);
    vi.mocked(listSessions).mockResolvedValue([DEFAULT_META, WORK_META]);
    vi.mocked(switchSession).mockResolvedValue(WORK_META);
  });

  it('load() pulls current + list from the backend', async () => {
    await act(async () => {
      await useSessionStore.getState().load();
    });

    expect(getCurrentSession).toHaveBeenCalledTimes(1);
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().current?.id).toBe('default');
    expect(useSessionStore.getState().list).toHaveLength(2);
  });
});

describe('SessionSelect', () => {
  beforeEach(() => {
    act(() => {
      useSessionStore.setState({
        id: DEFAULT_META.id,
        path: null,
        current: DEFAULT_META,
        list: [DEFAULT_META, WORK_META],
      });
    });
    vi.mocked(switchSession).mockClear();
    vi.mocked(switchSession).mockResolvedValue(WORK_META);
  });

  it('renders the current session name and lists siblings when opened', () => {
    render(<SessionSelect />);
    const button = screen.getByTestId('dc-session-button');
    expect(button.textContent ?? '').toContain('Default');

    fireEvent.click(button);

    expect(screen.getByTestId('dc-session-menu')).toBeInTheDocument();
    expect(screen.getByTestId('dc-session-item-default')).toBeInTheDocument();
    expect(screen.getByTestId('dc-session-item-work')).toBeInTheDocument();
  });

  it('calls switchSession(id) when a sibling is clicked', async () => {
    render(<SessionSelect />);
    fireEvent.click(screen.getByTestId('dc-session-button'));
    fireEvent.click(screen.getByTestId('dc-session-item-work'));

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith('work');
    });
    await waitFor(() => {
      expect(useSessionStore.getState().current?.id).toBe('work');
    });
  });
});
