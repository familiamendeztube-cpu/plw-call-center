import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-plw-ink sm:text-3xl">{title}</h1>
        {description ? (
          // A narrow window needs its height for the work itself, not the page's explanation.
          <p className="mt-2 hidden max-w-2xl text-sm leading-relaxed text-neutral-600 lg:block">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
