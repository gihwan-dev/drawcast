// First-run onboarding overlay. Wireframe: docs/06a-ui-design.md §12.2.
//
// Contract (PR #22, Phase 6.4):
// - Rendered when the user has neither picked a CLI (settingsStore.cliChoice
//   === null) nor dismissed the overlay (welcomeStore.dismissed === false).
// - Offers two paths forward:
//     a) Pick a CLI + click "Connect" → registerCli + spawnCli + persist
//        the choice in settingsStore. The overlay hides automatically
//        because `cliChoice` is no longer null.
//     b) "Load sample session" — populates sceneStore with two boxes and
//        an arrow via `loadSampleScene()` so the canvas is no longer
//        empty. Useful for users who want to look around before wiring
//        up a CLI.
// - "Skip for now" calls `welcomeStore.dismiss()` — the overlay stays
//   hidden even if cliChoice is still null.
// - The CLI radio buttons are labelled with a detection hint. The Rust
//   `check_cli_installed` command is called once per choice; if the
//   binary isn't found we render "(not detected)" and a follow-up tip
//   pointing at the install docs.
//
// Styling follows the Cozy Paper Studio palette — soft bone panels on
// paper cream, Drawcast Red CTA. A `backdrop-blur-sm` keeps the
// underlying workspace visible but out of focus.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CliChoice } from '../store/settingsStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { useWelcomeStore } from '../store/welcomeStore.js';
import { useSessionStore } from '../store/sessionStore.js';
import {
  checkCliInstalled,
  registerCli,
  spawnCli,
} from '../services/cli.js';
import { loadSampleScene } from '../services/sample.js';

type Detection = 'unknown' | 'detected' | 'missing' | 'checking';

interface CliOption {
  value: Exclude<CliChoice, null>;
  label: string;
  hint: string;
}

const OPTIONS: readonly CliOption[] = [
  {
    value: 'claude-code',
    label: 'Claude Code',
    hint: 'Anthropic CLI — `claude` on PATH',
  },
  {
    value: 'codex',
    label: 'Codex CLI',
    hint: 'OpenAI Codex — `codex` on PATH',
  },
];

type ConnectState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string };

export function Welcome(): JSX.Element {
  const dismiss = useWelcomeStore((s) => s.dismiss);
  const setCliChoice = useSettingsStore((s) => s.setCliChoice);
  const sessionPath = useSessionStore((s) => s.path);

  const [picked, setPicked] = useState<Exclude<CliChoice, null> | null>(null);
  const [detection, setDetection] = useState<Record<string, Detection>>({
    'claude-code': 'unknown',
    codex: 'unknown',
  });
  const [connect, setConnect] = useState<ConnectState>({ kind: 'idle' });

  // Probe installation status for whichever CLI the user selected. We
  // don't probe eagerly on mount because a failed lookup on PATH can
  // take a measurable fraction of a second on Windows — waiting until
  // the user expresses interest keeps the initial paint snappy.
  useEffect(() => {
    if (picked === null) return;
    if (detection[picked] !== 'unknown') return;
    let cancelled = false;
    setDetection((d) => ({ ...d, [picked]: 'checking' }));
    void (async () => {
      const ok = await checkCliInstalled(picked);
      if (cancelled) return;
      setDetection((d) => ({ ...d, [picked]: ok ? 'detected' : 'missing' }));
    })();
    return () => {
      cancelled = true;
    };
  }, [picked, detection]);

  const canConnect = useMemo(() => {
    if (picked === null) return false;
    if (connect.kind === 'working') return false;
    if (sessionPath === null) return false;
    // Allow attempting Connect even when detection is missing — the CLI
    // spawn path surfaces the binary-not-found error as a toast, which
    // is actionable feedback. The UI just flags the risk ahead of time.
    return true;
  }, [picked, connect, sessionPath]);

  const onConnect = useCallback(async (): Promise<void> => {
    if (picked === null || sessionPath === null) return;
    setConnect({ kind: 'working' });
    try {
      await registerCli(picked);
      await spawnCli(picked, sessionPath);
      setCliChoice(picked);
      dismiss();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnect({ kind: 'error', message });
    }
  }, [picked, sessionPath, setCliChoice, dismiss]);

  const onLoadSample = useCallback((): void => {
    loadSampleScene();
  }, []);

  const onSkip = useCallback((): void => {
    dismiss();
  }, [dismiss]);

  return (
    <div
      data-testid="dc-welcome"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dc-welcome-title"
      className="absolute inset-0 z-[300] flex items-center justify-center bg-dc-bg-app/70 backdrop-blur-sm"
    >
      <div className="w-[min(560px,92vw)] rounded-dc-lg border border-dc-border-hairline bg-dc-bg-elevated p-dc-xl shadow-dc-e2">
        <h1
          id="dc-welcome-title"
          className="text-center text-[32px] font-semibold text-dc-text-primary"
          style={{ fontFamily: 'Excalifont, Virgil, sans-serif' }}
        >
          Drawcast
        </h1>
        <p className="mt-dc-sm text-center text-[13px] text-dc-text-secondary">
          Structured Excalidraw diagrams via your CLI.
        </p>

        <fieldset className="mt-dc-xl">
          <legend className="mb-dc-sm text-[12px] font-semibold uppercase tracking-wide text-dc-text-secondary">
            Step 1. Choose your CLI
          </legend>
          <div className="flex flex-col gap-dc-sm sm:flex-row">
            {OPTIONS.map((opt) => {
              const isSelected = picked === opt.value;
              const state = detection[opt.value];
              return (
                <label
                  key={opt.value}
                  data-testid={`dc-welcome-option-${opt.value}`}
                  className={[
                    'flex-1 cursor-pointer rounded-dc-md border p-dc-md transition-colors',
                    isSelected
                      ? 'border-dc-accent-primary bg-dc-bg-app'
                      : 'border-dc-border-hairline hover:bg-dc-bg-hover',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="dc-welcome-cli"
                    value={opt.value}
                    checked={isSelected}
                    onChange={() => setPicked(opt.value)}
                    className="sr-only"
                  />
                  <span className="block text-[14px] font-medium text-dc-text-primary">
                    {opt.label}
                  </span>
                  <span className="mt-dc-xs block text-[12px] text-dc-text-secondary">
                    {opt.hint}
                  </span>
                  {state !== 'unknown' && (
                    <span
                      data-testid={`dc-welcome-detect-${opt.value}`}
                      className={[
                        'mt-dc-xs block text-[11px] font-mono',
                        state === 'detected'
                          ? 'text-dc-status-success'
                          : state === 'missing'
                            ? 'text-dc-status-danger'
                            : 'text-dc-text-tertiary',
                      ].join(' ')}
                    >
                      {state === 'checking' && 'checking…'}
                      {state === 'detected' && 'detected on PATH'}
                      {state === 'missing' && 'not detected — install first'}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-dc-xl">
          <button
            type="button"
            data-testid="dc-welcome-connect"
            disabled={!canConnect}
            onClick={() => {
              void onConnect();
            }}
            className="h-10 w-full rounded-dc-md bg-dc-accent-primary px-dc-lg text-[14px] font-medium text-dc-text-inverse transition-colors hover:bg-dc-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connect.kind === 'working' ? 'Connecting…' : 'Connect CLI'}
          </button>
          {connect.kind === 'error' && (
            <p
              data-testid="dc-welcome-error"
              className="mt-dc-sm text-[12px] text-dc-status-danger"
              role="alert"
            >
              {connect.message}
            </p>
          )}
        </div>

        <div className="mt-dc-lg flex items-center justify-between text-[12px] text-dc-text-secondary">
          <button
            type="button"
            data-testid="dc-welcome-sample"
            onClick={onLoadSample}
            className="underline underline-offset-2 hover:text-dc-text-primary"
          >
            Load sample session
          </button>
          <button
            type="button"
            data-testid="dc-welcome-skip"
            onClick={onSkip}
            className="underline underline-offset-2 hover:text-dc-text-primary"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
