// Left-side panel: hosts an xterm.js terminal attached to a Claude Code /
// Codex child process via the Rust CLI host. Renders an empty state with a
// "Connect CLI" affordance when no child is running.
//
// Limitation (PR #14): the Rust side uses plain OS pipes, not a real PTY.
// Many CLIs detect this and downgrade to non-interactive behaviour (no
// colors, no raw-mode input). Real PTY support via `portable-pty` is a
// post-MVP follow-up.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ITerminalOptions,
  Terminal as XTerminal,
} from '@xterm/xterm';
import type { FitAddon as FitAddonType } from '@xterm/addon-fit';
import {
  getDefaultSessionPath,
  registerCli,
  resizeCli,
  sendStdin,
  shutdownCli,
  spawnCli,
  subscribeCliExit,
  subscribeCliOutput,
  type CliChoice,
  type RegistrationStatus,
} from '../services/cli.js';
import { useCliStore } from '../store/cliStore.js';
import { useSessionStore } from '../store/sessionStore.js';
import { useSettingsStore } from '../store/settingsStore.js';

const XTERM_OPTIONS: ITerminalOptions = {
  fontFamily: 'JetBrains Mono, Cascadia Code, monospace',
  fontSize: 13,
  cursorBlink: true,
  convertEol: true,
  allowProposedApi: false,
  theme: {
    background: '#1E1E1E',
    foreground: '#EDE6D7',
    cursor: '#EDE6D7',
  },
};

type ConnectState =
  | { kind: 'idle' }
  | { kind: 'registering' }
  | { kind: 'spawning'; status: RegistrationStatus }
  | { kind: 'error'; message: string };

export function TerminalPanel(): JSX.Element {
  const cliRunning = useCliStore((s) => s.running);
  const setCliRunning = useCliStore((s) => s.setRunning);
  const sessionPath = useSessionStore((s) => s.path);
  const setSessionPath = useSessionStore((s) => s.setPath);
  const cliChoice = useSettingsStore((s) => s.cliChoice);

  // Ensure we know the session path. This runs once on mount.
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

  if (cliRunning) {
    return <TerminalView />;
  }
  return (
    <TerminalEmptyState
      cliChoice={cliChoice}
      sessionPath={sessionPath}
      onAttached={(which) => setCliRunning(true, which)}
    />
  );
}

interface EmptyStateProps {
  cliChoice: CliChoice | null;
  sessionPath: string | null;
  onAttached(which: CliChoice): void;
}

function TerminalEmptyState(props: EmptyStateProps): JSX.Element {
  const { cliChoice, sessionPath, onAttached } = props;
  const setCliChoice = useSettingsStore((s) => s.setCliChoice);
  const [state, setState] = useState<ConnectState>({ kind: 'idle' });
  const canConnect =
    cliChoice !== null &&
    sessionPath !== null &&
    (state.kind === 'idle' || state.kind === 'error');

  const handleConnect = useCallback(async () => {
    if (cliChoice === null || sessionPath === null) return;
    setState({ kind: 'registering' });
    try {
      const status = await registerCli(cliChoice);
      setState({ kind: 'spawning', status });
      await spawnCli(cliChoice, sessionPath);
      onAttached(cliChoice);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, [cliChoice, sessionPath, onAttached]);

  let statusLine: string | null = null;
  if (state.kind === 'registering') {
    statusLine = 'Registering Drawcast with the CLI config…';
  } else if (state.kind === 'spawning') {
    const verb =
      state.status === 'added'
        ? 'added'
        : state.status === 'updated'
          ? 'updated'
          : 'already present';
    statusLine = `Registration ${verb}. Launching CLI…`;
  } else if (state.kind === 'error') {
    statusLine = `Error: ${state.message}`;
  }

  return (
    <section
      data-testid="dc-terminal-empty"
      className="flex h-full flex-col items-center justify-center bg-dc-bg-panel px-dc-lg"
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <p
          className="text-[32px] leading-10 text-dc-text-primary"
          style={{ fontFamily: 'Excalifont, Virgil, "JetBrains Mono", monospace' }}
        >
          Drop to attach
        </p>
        <p className="mt-dc-sm text-[13px] text-dc-text-secondary">
          Drawcast will wire its MCP server into the CLI config and spawn the
          session here. Pick a CLI to get started.
        </p>
        <fieldset
          className="mt-dc-lg flex flex-col items-start gap-dc-xs self-stretch"
          data-testid="dc-terminal-cli-radio"
        >
          <legend className="sr-only">CLI</legend>
          <CliRadio
            value="claude-code"
            label="Claude Code"
            checked={cliChoice === 'claude-code'}
            onSelect={setCliChoice}
          />
          <CliRadio
            value="codex"
            label="Codex"
            checked={cliChoice === 'codex'}
            onSelect={setCliChoice}
          />
        </fieldset>
        <button
          type="button"
          data-testid="dc-terminal-connect"
          disabled={!canConnect}
          onClick={handleConnect}
          className="mt-dc-lg h-9 rounded-dc-md bg-dc-accent-primary px-dc-lg text-[13px] font-medium text-dc-text-inverse transition-colors hover:bg-dc-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Connect CLI
        </button>
        {statusLine !== null && (
          <p
            data-testid="dc-terminal-status"
            className={`mt-dc-sm text-[12px] ${
              state.kind === 'error'
                ? 'text-dc-status-danger'
                : 'text-dc-text-secondary'
            }`}
          >
            {statusLine}
          </p>
        )}
      </div>
    </section>
  );
}

interface CliRadioProps {
  value: Exclude<CliChoice, null>;
  label: string;
  checked: boolean;
  onSelect(v: Exclude<CliChoice, null>): void;
}

function CliRadio(props: CliRadioProps): JSX.Element {
  const { value, label, checked, onSelect } = props;
  return (
    <label className="flex items-center gap-dc-xs text-[13px] text-dc-text-primary">
      <input
        type="radio"
        name="dc-cli-radio"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

function TerminalView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCliRunning = useCliStore((s) => s.setRunning);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let unsubOutput: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;

    void (async () => {
      // Dynamic imports keep xterm out of the jsdom test bundle. They also
      // defer the ~180KB runtime until the first real terminal is mounted.
      const xtermModule = await import('@xterm/xterm');
      const fitModule = await import('@xterm/addon-fit');
      if (cancelled) return;
      const term = new xtermModule.Terminal(XTERM_OPTIONS);
      const fit = new fitModule.FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      // Forward keystrokes to the CLI. The host's write_stdin emits raw
      // bytes which the CLI sees as pipe input.
      const dataDisposable = term.onData((data) => {
        void sendStdin(data).catch(() => {
          term.write('\r\n[drawcast: CLI disconnected]\r\n');
        });
      });

      unsubOutput = subscribeCliOutput((ev) => {
        term.write(ev.data);
      });
      unsubExit = subscribeCliExit((code) => {
        term.write(`\r\n[CLI exited with code ${code ?? 'null'}]\r\n`);
        setCliRunning(false);
      });

      // Debounce resize to 100ms — ResizeObserver can fire many times during
      // splitter drags.
      observer = new ResizeObserver(() => {
        if (resizeTimerRef.current !== null) {
          clearTimeout(resizeTimerRef.current);
        }
        resizeTimerRef.current = setTimeout(() => {
          resizeTimerRef.current = null;
          if (fitRef.current === null || termRef.current === null) return;
          try {
            fitRef.current.fit();
          } catch {
            return;
          }
          const cols = termRef.current.cols;
          const rows = termRef.current.rows;
          void resizeCli(cols, rows).catch(() => {
            // Non-fatal; the CLI host logs and moves on.
          });
        }, 100);
      });
      observer.observe(el);

      // Store a combined disposer on the term ref so the outer cleanup
      // doesn't need to re-run async work.
      (term as unknown as { _drawcastCleanup?: () => void })._drawcastCleanup =
        () => {
          dataDisposable.dispose();
        };
    })();

    return () => {
      cancelled = true;
      if (observer !== null) observer.disconnect();
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      if (unsubOutput !== null) unsubOutput();
      if (unsubExit !== null) unsubExit();
      const term = termRef.current;
      if (term !== null) {
        const cleanup = (term as unknown as { _drawcastCleanup?: () => void })
          ._drawcastCleanup;
        cleanup?.();
        term.dispose();
        termRef.current = null;
      }
      fitRef.current = null;
      // Ask the host to clean up its child; if it's already gone this is a
      // cheap no-op.
      void shutdownCli().catch(() => undefined);
    };
  }, [setCliRunning]);

  return (
    <div
      data-testid="dc-terminal-host"
      className="h-full w-full bg-[#1E1E1E] p-dc-sm"
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
