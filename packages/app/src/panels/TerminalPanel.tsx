// Left-side panel: hosts an xterm.js terminal attached to a Claude Code /
// Codex child process via the Rust CLI host. Renders an empty state with a
// "Connect CLI" affordance when no child is running.
//
// Responsibilities beyond the raw terminal (PR #16):
// - Drag-drop files onto the panel → `save_upload` for each → toast.
// - Clipboard paste (image blobs) → `save_upload` as `paste-{ts}.{ext}`.
// - Sketchy dashed overlay while the user is dragging over us.
// - Expose `writeToActiveTerminal(text)` so other modules (the selection
//   bridge's context menu, the single-file drop flow) can shove text into
//   the live xterm as if it had been typed.
//
// Limitation (PR #14): the Rust side uses plain OS pipes, not a real PTY.
// Many CLIs detect this and downgrade to non-interactive behaviour (no
// colors, no raw-mode input). Real PTY support via `portable-pty` is a
// post-MVP follow-up.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react';
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
import { saveUpload, saveUploads } from '../services/uploads.js';
import { useCliStore } from '../store/cliStore.js';
import { useSessionStore } from '../store/sessionStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { useToastStore } from '../store/toastStore.js';

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

// ---------------------------------------------------------------------------
// Module-scope terminal registry — lets other modules (PR #17 context menu,
// PR #16 single-file drop) write into the active xterm as if typed. `.paste`
// dispatches through xterm's onData → sendStdin path, which is exactly what
// a real keyboard event would do.

let activeTerminal: XTerminal | null = null;

/** Inject `text` into the live terminal as if the user had typed it. */
export function writeToActiveTerminal(text: string): void {
  if (activeTerminal !== null) {
    activeTerminal.paste(text);
  }
}

/** Test hook: clears the module-scope terminal registry. */
export function __resetActiveTerminalForTests(): void {
  activeTerminal = null;
}

function extFromMime(mime: string): string {
  const sub = mime.split('/')[1] ?? 'bin';
  return sub.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
}

// ---------------------------------------------------------------------------
// Component

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

  const inner = cliRunning ? (
    <TerminalView />
  ) : (
    <TerminalEmptyState
      cliChoice={cliChoice}
      sessionPath={sessionPath}
      onAttached={(which) => setCliRunning(true, which)}
    />
  );

  return <TerminalUploadLayer cliRunning={cliRunning}>{inner}</TerminalUploadLayer>;
}

interface UploadLayerProps {
  cliRunning: boolean;
  children: ReactNode;
}

/** Wraps the terminal/empty-state with drag-drop + paste upload affordances
 *  and the sketchy dashed overlay during `dragover`. */
function TerminalUploadLayer({ cliRunning, children }: UploadLayerProps): JSX.Element {
  const show = useToastStore((s) => s.show);
  const [dragOver, setDragOver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>): void => {
    // Required for `drop` to fire. We also need to signal copy intent so
    // the cursor shows the "drop here" affordance.
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragEnter = useCallback((e: ReactDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    // Only enter drop state for actual file drags. Text/URL drags from
    // within the page shouldn't trigger the overlay.
    const types = e.dataTransfer?.types;
    if (types !== undefined) {
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') {
          setDragOver(true);
          return;
        }
      }
    }
  }, []);

  const handleDragLeave = useCallback(
    (e: ReactDragEvent<HTMLDivElement>): void => {
      // A `dragleave` fires even when moving between the panel's own
      // children. Guard by checking the related target — if it's still
      // inside our root, swallow.
      const root = rootRef.current;
      const related = e.relatedTarget as Node | null;
      if (root !== null && related !== null && root.contains(related)) return;
      setDragOver(false);
    },
    [],
  );

  const handleDrop = useCallback(
    async (e: ReactDragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer?.files ?? null;
      if (files === null || files.length === 0) return;

      const list: File[] = [];
      for (let i = 0; i < files.length; i++) {
        // `FileList.item` exists in browsers but not in some test harnesses
        // that pass a plain array through `fireEvent`. Fall back to index
        // access so the path works under jsdom.
        const withItem = files as FileList & {
          item?: (i: number) => File | null;
        };
        const f =
          typeof withItem.item === 'function'
            ? withItem.item(i)
            : (files[i] ?? null);
        if (f !== null) list.push(f);
      }
      try {
        const saved = await saveUploads(list);
        if (saved.length === 0) return;
        show(`Saved ${saved.length} file${saved.length === 1 ? '' : 's'}`, 'success');
        if (saved.length === 1 && cliRunning) {
          const first = saved[0];
          if (first !== undefined) {
            writeToActiveTerminal(`@uploads/${first.fileName} `);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(`Upload failed: ${msg}`, 'error');
      }
    },
    [cliRunning, show],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>): Promise<void> => {
      const items = e.clipboardData?.items;
      if (items === undefined || items.length === 0) return;
      const images: { file: File; name: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it === undefined) continue;
        if (!it.type.startsWith('image/')) continue;
        const file = it.getAsFile();
        if (file === null) continue;
        const ext = extFromMime(it.type);
        const name = `paste-${Date.now()}-${i}.${ext}`;
        images.push({ file, name });
      }
      if (images.length === 0) return;
      // Only prevent default once we know we'll consume the paste; a plain
      // text paste should still reach the terminal.
      e.preventDefault();
      try {
        for (const { file, name } of images) {
          const buf = await file.arrayBuffer();
          await saveUpload(name, buf);
        }
        show(
          `Saved ${images.length} file${images.length === 1 ? '' : 's'}`,
          'success',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(`Paste failed: ${msg}`, 'error');
      }
    },
    [show],
  );

  return (
    <div
      ref={rootRef}
      data-testid="dc-terminal-upload-layer"
      data-dragging={dragOver ? 'true' : 'false'}
      className="relative h-full w-full"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        void handleDrop(e);
      }}
      onPaste={(e) => {
        void handlePaste(e);
      }}
    >
      {children}
      {dragOver && <DropZoneOverlay />}
    </div>
  );
}

/** Sketchy dashed-border overlay matching UI design doc §4.10. The SVG
 *  inset dashed rect mimics Excalidraw's `strokeStyle: 'dashed'` look. */
function DropZoneOverlay(): JSX.Element {
  return (
    <div
      data-testid="dc-drop-overlay"
      aria-label="Drop files to attach"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-dc-bg-app/[.92]"
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <rect
          x="8"
          y="8"
          width="calc(100% - 16px)"
          height="calc(100% - 16px)"
          fill="none"
          stroke="var(--dc-border-strong, #C9C0AE)"
          strokeWidth="2"
          strokeDasharray="10 6 4 6 8 4"
          strokeLinecap="round"
          rx="6"
        />
      </svg>
      <div className="flex flex-col items-center text-center">
        <p
          className="text-[28px] leading-none text-dc-text-primary"
          style={{ fontFamily: 'Excalifont, Virgil, "JetBrains Mono", monospace' }}
        >
          Drop to attach
        </p>
        <p className="mt-dc-sm text-[14px] text-dc-text-secondary">
          PNG, SVG, .excalidraw, text files
        </p>
      </div>
    </div>
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
      activeTerminal = term;

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
        if (activeTerminal === term) activeTerminal = null;
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
