// First-run onboarding overlay.
//
// The old flow let the user pick between Claude Code and Codex and then
// wrote MCP config to ~/.claude.json / ~/.codex/config.toml. The new flow
// is much simpler: we drive `claude` CLI exclusively, and reuse whatever
// OAuth session the user already established via `claude login` (Pro/Max
// subscription). So Welcome's job is reduced to:
//
//   1. Detect whether `claude` is on PATH (`check_claude_installed`).
//   2. If missing, explain how to install + link to the install guide.
//   3. If present, offer two CTAs: "Start chatting" (dismiss overlay) and
//      "Load sample session" (populate a throwaway scene so the canvas
//      is non-empty while the user ramps up).
//
// The per-session MCP config that tells `claude` about our Drawcast MCP
// is written by `chat_host` lazily on the first message — no click here
// is required to wire it up.

import { useCallback, useEffect, useState } from 'react';
import { useWelcomeStore } from '../store/welcomeStore.js';
import { checkClaudeInstalled } from '../services/chat.js';
import { loadSampleScene } from '../services/sample.js';

type Detection = 'checking' | 'detected' | 'missing';

export function Welcome(): JSX.Element {
  const dismiss = useWelcomeStore((s) => s.dismiss);
  const [detection, setDetection] = useState<Detection>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await checkClaudeInstalled();
      if (cancelled) return;
      setDetection(ok ? 'detected' : 'missing');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onStart = useCallback((): void => {
    dismiss();
  }, [dismiss]);

  const onLoadSample = useCallback((): void => {
    loadSampleScene();
  }, []);

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
          Claude와 채팅하며 Excalidraw 다이어그램을 그립니다. 사용자의
          `claude login` OAuth 세션(Pro/Max 구독)이 그대로 쓰입니다.
        </p>

        <div className="mt-dc-xl rounded-dc-md border border-dc-border-hairline bg-dc-bg-app p-dc-md">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-dc-text-secondary">
            Step 1. Claude CLI
          </p>
          <div
            data-testid={`dc-welcome-detect-${detection}`}
            className="mt-dc-xs font-mono text-[12px]"
          >
            {detection === 'checking' && (
              <span className="text-dc-text-tertiary">detecting…</span>
            )}
            {detection === 'detected' && (
              <span className="text-dc-status-success">✓ detected on PATH</span>
            )}
            {detection === 'missing' && (
              <span className="text-dc-status-danger">
                ✗ not detected — install the Claude CLI then run `claude login`.
              </span>
            )}
          </div>
          {detection === 'missing' && (
            <p className="mt-dc-sm text-[12px] text-dc-text-secondary">
              설치 안내:
              <a
                href="https://docs.claude.com/en/docs/claude-code/quickstart"
                target="_blank"
                rel="noreferrer"
                className="ml-dc-xs underline underline-offset-2 hover:text-dc-text-primary"
              >
                docs.claude.com/claude-code/quickstart
              </a>
            </p>
          )}
        </div>

        <div className="mt-dc-xl">
          <button
            type="button"
            data-testid="dc-welcome-start"
            onClick={onStart}
            disabled={detection === 'missing'}
            className="h-10 w-full rounded-dc-md bg-dc-accent-primary px-dc-lg text-[14px] font-medium text-dc-text-inverse transition-colors hover:bg-dc-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {detection === 'missing' ? 'Claude CLI 필요' : 'Start chatting'}
          </button>
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
            onClick={onStart}
            className="underline underline-offset-2 hover:text-dc-text-primary"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
