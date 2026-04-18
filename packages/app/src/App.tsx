import { useEffect } from 'react';
import { PanelShell } from './components/PanelShell.js';
import { Splitter } from './components/Splitter.js';
import { StatusBar } from './components/StatusBar.js';
import { TopBar } from './components/TopBar.js';
import {
  getSidecarPort,
  subscribeSidecar,
} from './mcp/sidecarBridge.js';
import { useMcpConnected } from './mcp/context.js';
import { CanvasPanel } from './panels/CanvasPanel.js';
import { useSettingsStore } from './store/settingsStore.js';
import { useSidecarStore } from './store/sidecarStore.js';

/**
 * Root app layout: TopBar + left/right split + StatusBar.
 *
 * - PR #13 replaces `<CanvasPlaceholder />` with the real `<Excalidraw />`
 *   wrapper.
 * - PR #14 replaces `<TerminalPlaceholder />` with the xterm.js host.
 */
export function App(): JSX.Element {
  const panelRatio = useSettingsStore((s) => s.panelRatio);
  const setPanelRatio = useSettingsStore((s) => s.setPanelRatio);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const connected = useMcpConnected();

  const setReady = useSidecarStore((s) => s.setReady);
  const setCrashed = useSidecarStore((s) => s.setCrashed);
  const setStarting = useSidecarStore((s) => s.setStarting);

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

  return (
    <div className="flex h-screen flex-col bg-dc-bg-app text-dc-text-primary">
      <TopBar />
      <Splitter
        ratio={panelRatio}
        onRatioChange={setPanelRatio}
        left={<TerminalPlaceholder />}
        right={<CanvasPanel />}
      />
      <StatusBar />
    </div>
  );
}

function TerminalPlaceholder(): JSX.Element {
  return (
    <PanelShell title="Terminal" subtitle="xterm.js host (PR #14)">
      <p className="text-[13px] leading-5 text-dc-text-secondary">
        Drawcast will spawn the configured CLI (Claude Code or Codex) here in a
        later PR. For now this is a typed placeholder so the layout, splitter,
        and theme tokens can be reviewed in isolation.
      </p>
    </PanelShell>
  );
}
