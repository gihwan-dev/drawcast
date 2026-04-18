// React context that exposes the live `McpClient` to anything below the
// provider. The provider owns the hook so the client lifecycle follows
// the React tree rather than being duplicated in every consumer.
//
// `useMcp` returns `null` while the sidecar is still coming up; callers
// should guard with `if (client !== null)` before posting.

import React, { createContext, useContext } from 'react';
import type { McpClient } from './client.js';
import { useMcpClient } from './useMcpClient.js';

export interface McpContextValue {
  client: McpClient | null;
  connected: boolean;
}

// Exported so tests (and any future layered providers) can stub a fixed
// value without rewiring the hook.
export const McpClientContext = createContext<McpContextValue>({
  client: null,
  connected: false,
});

export function McpClientProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const value = useMcpClient();
  return (
    <McpClientContext.Provider value={value}>
      {children}
    </McpClientContext.Provider>
  );
}

export function useMcp(): McpClient | null {
  return useContext(McpClientContext).client;
}

export function useMcpConnected(): boolean {
  return useContext(McpClientContext).connected;
}
