/**
 * Tailwind consumes the `--dc-*` CSS variables defined in
 * `src/theme/tokens.css`. Adding a key under `theme.extend.colors.dc` makes
 * utilities like `bg-dc-bg-app` / `text-dc-text-primary` resolve at runtime
 * against whichever palette (`:root` vs `[data-theme='dark']`) is active.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dc: {
          'bg-app': 'var(--dc-bg-app)',
          'bg-panel': 'var(--dc-bg-panel)',
          'bg-elevated': 'var(--dc-bg-elevated)',
          'bg-canvas-stage': 'var(--dc-bg-canvas-stage)',
          'bg-hover': 'var(--dc-bg-hover)',
          'bg-active': 'var(--dc-bg-active)',
          'bg-selection': 'var(--dc-bg-selection)',
          'border-hairline': 'var(--dc-border-hairline)',
          'border-strong': 'var(--dc-border-strong)',
          'border-focus': 'var(--dc-border-focus)',
          'text-primary': 'var(--dc-text-primary)',
          'text-secondary': 'var(--dc-text-secondary)',
          'text-tertiary': 'var(--dc-text-tertiary)',
          'text-inverse': 'var(--dc-text-inverse)',
          'accent-primary': 'var(--dc-accent-primary)',
          'accent-primary-hover': 'var(--dc-accent-primary-hover)',
          'status-success': 'var(--dc-status-success)',
          'status-warning': 'var(--dc-status-warning)',
          'status-danger': 'var(--dc-status-danger)',
          'status-info': 'var(--dc-status-info)',
          'terminal-bg': 'var(--dc-terminal-bg)',
          'terminal-fg': 'var(--dc-terminal-fg)',
        },
      },
      spacing: {
        'dc-xxs': 'var(--dc-space-xxs)',
        'dc-xs': 'var(--dc-space-xs)',
        'dc-sm': 'var(--dc-space-sm)',
        'dc-md': 'var(--dc-space-md)',
        'dc-lg': 'var(--dc-space-lg)',
        'dc-xl': 'var(--dc-space-xl)',
        'dc-2xl': 'var(--dc-space-2xl)',
        'dc-3xl': 'var(--dc-space-3xl)',
      },
      borderRadius: {
        'dc-sm': 'var(--dc-radius-sm)',
        'dc-md': 'var(--dc-radius-md)',
        'dc-lg': 'var(--dc-radius-lg)',
        'dc-full': 'var(--dc-radius-full)',
      },
      boxShadow: {
        'dc-e1': 'var(--dc-shadow-e1)',
        'dc-e2': 'var(--dc-shadow-e2)',
        'dc-e3': 'var(--dc-shadow-e3)',
      },
      fontFamily: {
        ui: [
          'Inter',
          'Pretendard Variable',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
