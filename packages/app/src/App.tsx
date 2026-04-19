import { useEffect } from 'react';
import { Splitter } from './components/Splitter.js';
import { StatusBar } from './components/StatusBar.js';
import { ToastStack } from './components/Toast.js';
import { TopBar } from './components/TopBar.js';
import {
  getSidecarPort,
  subscribeSidecar,
} from './mcp/sidecarBridge.js';
import { useMcpConnected } from './mcp/context.js';
import { CanvasPanel } from './panels/CanvasPanel.js';
import { ChatPanel } from './panels/ChatPanel.js';
import { Welcome } from './pages/Welcome.js';
import { getDefaultSessionPath } from './services/chat.js';
import { subscribeSessionSwitched } from './services/session.js';
import { useChatStore } from './store/chatStore.js';
import { useSceneStore } from './store/sceneStore.js';
import { useSessionStore } from './store/sessionStore.js';
import { useSettingsStore } from './store/settingsStore.js';
import { useSidecarStore } from './store/sidecarStore.js';
import { useWelcomeStore } from './store/welcomeStore.js';

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
  const welcomeDismissed = useWelcomeStore((s) => s.dismissed);
  const connected = useMcpConnected();

  const setReady = useSidecarStore((s) => s.setReady);
  const setCrashed = useSidecarStore((s) => s.setCrashed);
  const setStarting = useSidecarStore((s) => s.setStarting);
  const sessionPath = useSessionStore((s) => s.path);
  const setSessionPath = useSessionStore((s) => s.setPath);
  const loadSessions = useSessionStore((s) => s.load);
  const setCurrentSession = useSessionStore((s) => s.setCurrent);
  const refreshSessionList = useSessionStore((s) => s.refreshList);
  const resetScene = useSceneStore((s) => s.reset);

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

  // Bootstrap session state (current + list) and subscribe to the
  // `session-switched` event so the dropdown + sceneStore + chat history
  // all reset together when Rust orchestrates a switch.
  useEffect(() => {
    void loadSessions();
    const dispose = subscribeSessionSwitched((meta) => {
      setCurrentSession(meta);
      resetScene();
      useChatStore.getState().reset();
      void refreshSessionList();
    });
    return () => {
      dispose();
    };
  }, [loadSessions, refreshSessionList, resetScene, setCurrentSession]);

  // Show Welcome on first launch until the user explicitly dismisses it.
  // The new onboarding just verifies that `claude` is installed + logged in;
  // there is no CLI choice to gate on any more.
  const showWelcome = !welcomeDismissed;

  return (
    <div className="relative flex h-screen flex-col bg-dc-bg-app text-dc-text-primary">
      <TopBar />
      <Splitter
        ratio={panelRatio}
        onRatioChange={setPanelRatio}
        left={<ChatPanel />}
        right={<CanvasPanel />}
      />
      <StatusBar />
      <ToastStack />
      {showWelcome && <Welcome />}
    </div>
  );
}
