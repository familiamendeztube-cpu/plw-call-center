import type { ButtonHTMLAttributes } from 'react';
import { cx } from '@/components/ui/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-plw-navy text-white hover:bg-plw-deep shadow-sm',
  secondary:
    'bg-white text-plw-ink border border-neutral-200 hover:border-plw-gold hover:text-plw-navy',
  ghost: 'bg-transparent text-plw-navy hover:bg-plw-navy/5',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 shadow-sm',
  success: 'bg-success-600 text-white hover:bg-success-700 shadow-sm',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-lg font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...rest}
    />
  );
}
