// ChatStore persistence tests.
//
// Scene data already survives restarts thanks to the MCP-server sidecar;
// chat messages didn't, which made a fresh launch look like the scene had
// "lost its conversation". These cases lock in that messages round-trip
// through localStorage and that volatile runtime flags (isStreaming,
// ready, rateLimit, lastError) are NOT kept across sessions.

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function freshChatStoreModule(): Promise<
  typeof import('../src/store/chatStore.js')
> {
  vi.resetModules();
  return await import('../src/store/chatStore.js');
}

describe('chatStore — persistence (B5)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes messages to localStorage under the drawcast-chat key', async () => {
    const { useChatStore } = await freshChatStoreModule();
    useChatStore.setState({
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
          createdAt: 1,
          isStreaming: false,
        },
      ],
    });
    const raw = localStorage.getItem('drawcast-chat');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: { messages: unknown[] } };
    expect(parsed.state.messages).toHaveLength(1);
  });

  it('rehydrates the message list from localStorage on a fresh module load', async () => {
    localStorage.setItem(
      'drawcast-chat',
      JSON.stringify({
        state: {
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: [{ type: 'text', text: 'hello' }],
              createdAt: 1,
              isStreaming: false,
            },
          ],
          sessionId: 'session-abc',
        },
        version: 1,
      }),
    );
    const { useChatStore } = await freshChatStoreModule();
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]?.id).toBe('m1');
    expect(useChatStore.getState().sessionId).toBe('session-abc');
  });

  it('resets volatile runtime flags on rehydrate (isStreaming, ready, lastError, rateLimit)', async () => {
    localStorage.setItem(
      'drawcast-chat',
      JSON.stringify({
        state: {
          messages: [],
          sessionId: 's1',
          isStreaming: true,
          ready: true,
          lastError: 'boom',
          rateLimit: { some: 'info' },
        },
        version: 1,
      }),
    );
    const { useChatStore } = await freshChatStoreModule();
    const s = useChatStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.ready).toBe(false);
    expect(s.lastError).toBeNull();
    expect(s.rateLimit).toBeNull();
  });

  it('keeps the draft out of the persisted payload', async () => {
    const { useChatStore } = await freshChatStoreModule();
    useChatStore.getState().setDraftText('scratch text');
    const raw = localStorage.getItem('drawcast-chat');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.draft).toBeUndefined();
  });
});
