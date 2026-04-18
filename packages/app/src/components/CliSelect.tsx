// Small dropdown in the TopBar that lets the user pick which CLI Drawcast
// should launch. Persisted via settingsStore so the choice survives
// restarts.
import { useSettingsStore } from '../store/settingsStore.js';
import type { CliChoice } from '../store/settingsStore.js';

const OPTIONS: Array<{ value: Exclude<CliChoice, null> | ''; label: string }> = [
  { value: '', label: 'No CLI' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

export function CliSelect(): JSX.Element {
  const cliChoice = useSettingsStore((s) => s.cliChoice);
  const setCliChoice = useSettingsStore((s) => s.setCliChoice);

  return (
    <label
      data-tauri-drag-region="false"
      className="flex items-center gap-dc-xs text-[12px] text-dc-text-secondary"
    >
      <span className="sr-only">CLI</span>
      <select
        data-testid="dc-cli-select"
        value={cliChoice ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          setCliChoice(raw === '' ? null : (raw as Exclude<CliChoice, null>));
        }}
        className="h-8 rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated px-dc-sm text-[13px] text-dc-text-primary transition-colors hover:bg-dc-bg-hover focus:border-dc-border-focus focus:outline-none"
        aria-label="Select which CLI to launch"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
