import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  trailing?: ReactNode;
}

export function TextField({ label, hint, trailing, className, ...rest }: TextFieldProps) {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-describedby={hint ? hintId : undefined}
          className={cx(
            'h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-plw-ink',
            'placeholder:text-neutral-400 transition-colors duration-150',
            'hover:border-white/20 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30',
            'disabled:cursor-not-allowed disabled:bg-white/[0.02] disabled:text-neutral-500',
            trailing ? 'pr-10' : undefined
          )}
          {...rest}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
