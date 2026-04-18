// React binding for the MCP client. Creates a fresh `createMcpClient`
// whenever the sidecar port changes and forwards incoming scene snapshots
// into `sceneStore`. The hook does not touch any Tauri APIs — it only
// reads the already-populated `sidecarStore.port`.
//
// Consumers read `{client, connected}`; the context provider in
// `./context.tsx` is how components further down the tree reach the
// client to post selection / preview responses.

import { useEffect, useState } from 'react';
import { useSidecarStore } from '../store/sidecarStore.js';
import { useSceneStore, type SceneSnapshot as StoreSnapshot } from '../store/sceneStore.js';
import {
  createMcpClient,
  type McpClient,
  type SceneSnapshot,
} from './client.js';

export interface UseMcpClient {
  client: McpClient | null;
  connected: boolean;
}

function toStoreSnapshot(snap: SceneSnapshot): StoreSnapshot {
  return {
    primitives: snap.primitives,
    theme: snap.theme,
    selection: snap.selection,
    locked: snap.locked,
  };
}

export function useMcpClient(): UseMcpClient {
  const port = useSidecarStore((s) => s.port);
  const [client, setClient] = useState<McpClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (port === null) {
      setClient(null);
      setConnected(false);
      return;
    }

    const next = createMcpClient(port);
    setClient(next);
    setConnected(false);

    const offScene = next.onScene((snap) => {
      useSceneStore.getState().setSnapshot(toStoreSnapshot(snap));
    });
    const offConn = next.onConnectionChange((isConnected) => {
      setConnected(isConnected);
    });

    next.connect();

    return () => {
      offScene();
      offConn();
      next.disconnect();
      setConnected(false);
    };
  }, [port]);

  return { client, connected };
}
