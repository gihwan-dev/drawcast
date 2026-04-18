import type { ReactNode } from 'react';

export interface PanelShellProps {
  title?: string;
  /** Caption shown under the title — usually tells the reader what ships later. */
  subtitle?: string;
  children?: ReactNode;
  /** Override default panel background. */
  tone?: 'panel' | 'elevated';
  className?: string;
}

/**
 * Generic wrapper used by the placeholder panels. Panels that want bespoke
 * chrome can ignore this and render their own markup.
 */
export function PanelShell({
  title,
  subtitle,
  children,
  tone = 'panel',
  className,
}: PanelShellProps): JSX.Element {
  const bg = tone === 'elevated' ? 'bg-dc-bg-elevated' : 'bg-dc-bg-panel';
  return (
    <section
      className={[
        'flex h-full flex-col overflow-hidden border-dc-border-hairline',
        bg,
        className ?? '',
      ].join(' ')}
    >
      {title !== undefined && (
        <header className="border-b border-dc-border-hairline px-dc-lg py-dc-sm">
          <h2 className="text-[15px] font-semibold text-dc-text-primary">
            {title}
          </h2>
          {subtitle !== undefined && (
            <p className="mt-dc-xxs text-[12px] text-dc-text-secondary">
              {subtitle}
            </p>
          )}
        </header>
      )}
      <div className="flex-1 min-h-0 overflow-auto p-dc-lg">{children}</div>
    </section>
  );
}
