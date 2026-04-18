import { useEffect } from 'react';
import { Splitter } from './components/Splitter.js';
import { StatusBar } from './components/StatusBar.js';
import { TopBar } from './components/TopBar.js';
import {
  getSidecarPort,
  subscribeSidecar,
} from './mcp/sidecarBridge.js';
import { useMcpConnected } from './mcp/context.js';
import { CanvasPanel } from './panels/CanvasPanel.js';
import { TerminalPanel } from './panels/TerminalPanel.js';
import { getDefaultSessionPath } from './services/cli.js';
import { useSessionStore } from './store/sessionStore.js';
import { useSettingsStore } from './store/settingsStore.js';
import { useSidecarStore } from './store/sidecarStore.js';

/**
 * Root app layout: TopBar + left/right split + StatusBar.
 *
 * - PR #13 replaces the canvas placeholder with the real `<Excalidraw />`
 *   wrapper.
 * - PR #14 replaces the terminal placeholder with the xterm.js host and
 *   wires Claude Code / Codex auto-registration.
 */
export function App(): JSX.Element {
  const panelRatio = useSettingsStore((s) => s.panelRatio);
  const setPanelRatio = useSettingsStore((s) => s.setPanelRatio);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const connected = useMcpConnected();

  const setReady = useSidecarStore((s) => s.setReady);
  const setCrashed = useSidecarStore((s) => s.setCrashed);
  const setStarting = useSidecarStore((s) => s.setStarting);
  const sessionPath = useSessionStore((s) => s.path);
  const setSessionPath = useSessionStore((s) => s.setPath);

  useEffect(() => {
    document.documentElement.dataset['theme'] = themeMode;
  }, [themeMode]);

  useEffect(() => {
    // Surface the transport connection state in dev builds so reviewers
    // can watch the SSE handshake without opening devtools.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug(
        `[drawcast] MCP ${connected ? 'connected' : 'disconnected'}`,
      );
    }
  }, [connected]);

  useEffect(() => {
    setStarting();
    const dispose = subscribeSidecar({
      onReady: (port) => setReady(port),
      onExit: (code) => {
        if (code !== 0) setCrashed(code);
      },
    });

    // The sidecar may have announced its port before this component mounted.
    // Catch up with a one-shot poll.
    void (async () => {
      const port = await getSidecarPort();
      if (port !== null) {
        setReady(port);
      }
    })();

    return () => {
      dispose();
    };
  }, [setReady, setCrashed, setStarting]);

  // Populate the session store from the Rust backend on first mount so
  // TerminalPanel has a cwd to spawn the CLI in.
  useEffect(() => {
    if (sessionPath !== null) return;
    let cancelled = false;
    void (async () => {
      const path = await getDefaultSessionPath();
      if (!cancelled && path !== null) {
        setSessionPath(path);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionPath, setSessionPath]);

  return (
    <div className="flex h-screen flex-col bg-dc-bg-app text-dc-text-primary">
      <TopBar />
      <Splitter
        ratio={panelRatio}
        onRatioChange={setPanelRatio}
        left={<TerminalPanel />}
        right={<CanvasPanel />}
      />
      <StatusBar />
    </div>
  );
}
