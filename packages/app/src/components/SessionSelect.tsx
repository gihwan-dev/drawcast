// Session picker for the TopBar. Shows the current session name with a
// caret; clicking opens a popover listing every session on disk plus a
// "New session…" affordance.
//
// Kept as a hand-rolled popover (instead of pulling in Radix) because the
// dropdown has exactly two interactions: click a row, or open the inline
// rename input. Not worth a new dep for PR #15.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../store/sessionStore.js';

export function SessionSelect(): JSX.Element {
  const current = useSessionStore((s) => s.current);
  const list = useSessionStore((s) => s.list);
  const switchTo = useSessionStore((s) => s.switchTo);
  const createAndSwitch = useSessionStore((s) => s.createAndSwitch);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape + click-outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false);
        setCreating(false);
      }
    };
    const onClick = (ev: MouseEvent) => {
      const root = rootRef.current;
      if (root !== null && !root.contains(ev.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const onPick = useCallback(
    async (id: string) => {
      if (busy) return;
      if (current?.id === id) {
        setOpen(false);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await switchTo(id);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, current?.id, switchTo],
  );

  const onCreate = useCallback(async () => {
    const name = draftName.trim();
    if (name.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createAndSwitch(name);
      setDraftName('');
      setCreating(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, createAndSwitch, draftName]);

  const label = current?.name ?? 'Default';

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region="false"
      className="relative"
      data-testid="dc-session-select"
    >
      <button
        type="button"
        data-testid="dc-session-button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-dc-xs rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated px-dc-sm text-[13px] text-dc-text-primary transition-colors hover:bg-dc-bg-hover focus:border-dc-border-focus focus:outline-none"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch session"
      >
        <span className="max-w-[12rem] truncate">{label}</span>
        <span aria-hidden="true" className="text-dc-text-secondary">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          data-testid="dc-session-menu"
          className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[14rem] rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated shadow-lg"
        >
          <ul className="max-h-64 overflow-y-auto py-dc-xs">
            {list.length === 0 ? (
              <li
                className="px-dc-sm py-dc-xs text-[12px] text-dc-text-secondary"
                role="none"
              >
                No sessions yet
              </li>
            ) : (
              list.map((session) => {
                const active = session.id === current?.id;
                return (
                  <li key={session.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`dc-session-item-${session.id}`}
                      onClick={() => {
                        void onPick(session.id);
                      }}
                      disabled={busy}
                      className={`flex w-full items-center justify-between px-dc-sm py-dc-xs text-left text-[13px] text-dc-text-primary transition-colors hover:bg-dc-bg-hover disabled:opacity-60 ${
                        active ? 'font-semibold' : ''
                      }`}
                    >
                      <span className="truncate">{session.name}</span>
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="ml-dc-sm text-[11px] text-dc-text-secondary"
                        >
                          ●
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-dc-border-hairline" />
          {creating ? (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                void onCreate();
              }}
              className="flex items-center gap-dc-xs p-dc-sm"
            >
              <input
                type="text"
                data-testid="dc-session-new-input"
                autoFocus
                value={draftName}
                onChange={(ev) => setDraftName(ev.target.value)}
                placeholder="Session name"
                disabled={busy}
                className="h-7 flex-1 rounded-dc-sm border border-dc-border-hairline bg-dc-bg-app px-dc-xs text-[13px] text-dc-text-primary focus:border-dc-border-focus focus:outline-none"
              />
              <button
                type="submit"
                data-testid="dc-session-new-submit"
                disabled={busy || draftName.trim().length === 0}
                className="h-7 rounded-dc-sm bg-dc-accent-primary px-dc-sm text-[12px] font-medium text-dc-text-inverse transition-opacity hover:bg-dc-accent-primary-hover disabled:opacity-60"
              >
                Create
              </button>
            </form>
          ) : (
            <button
              type="button"
              data-testid="dc-session-new"
              onClick={() => {
                setCreating(true);
                setDraftName('');
                setError(null);
              }}
              disabled={busy}
              className="flex w-full items-center px-dc-sm py-dc-xs text-left text-[13px] text-dc-text-secondary transition-colors hover:bg-dc-bg-hover disabled:opacity-60"
            >
              + New session…
            </button>
          )}
          {error !== null ? (
            <p
              role="alert"
              className="px-dc-sm pb-dc-xs text-[12px] text-dc-status-danger"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
