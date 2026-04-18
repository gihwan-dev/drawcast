import { CliSelect } from './CliSelect.js';
import { SessionSelect } from './SessionSelect.js';
import { UploadButton } from './UploadButton.js';
import { useSettingsStore } from '../store/settingsStore.js';

/**
 * 44px app-chrome strip. Hosts the logo, the CLI selector, and a theme-mode
 * toggle. Acts as a window drag region via `data-tauri-drag-region` so users
 * can move the window from the top bar; interactive children opt out with
 * `data-tauri-drag-region="false"`.
 */
export function TopBar(): JSX.Element {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 items-center justify-between border-b border-dc-border-hairline bg-dc-bg-app px-dc-lg select-none"
      role="banner"
    >
      <span
        data-tauri-drag-region
        className="text-[15px] font-semibold text-dc-text-primary tracking-tight"
      >
        Drawcast
      </span>
      <div className="flex items-center gap-dc-md">
        <SessionSelect />
        <CliSelect />
        <UploadButton />
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
          className="h-8 rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated px-dc-md text-[13px] text-dc-text-primary transition-colors hover:bg-dc-bg-hover"
          aria-label={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} mode`}
        >
          {themeMode === 'light' ? 'Light' : 'Dark'}
        </button>
      </div>
    </header>
  );
}
