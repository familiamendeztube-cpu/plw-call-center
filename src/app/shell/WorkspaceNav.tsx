import { NavLink } from 'react-router-dom';
import { cx } from '@/components/ui/cx';
import type { NavItem } from '@/app/shell/navigation';

interface WorkspaceNavProps {
  items: NavItem[];
  label: string;
}

export function WorkspaceNav({ items, label }: WorkspaceNavProps) {
  return (
    <nav
      aria-label={label}
      className="glass-panel mx-3 mb-3 overflow-x-auto p-1.5 scrollbar-thin sm:mx-5 sm:mb-4"
    >
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'flex h-11 items-center whitespace-nowrap rounded-[14px] px-4 text-sm font-medium',
                  'transition-colors duration-150 focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-plw-gold-soft focus-visible:ring-inset',
                  isActive
                    ? 'bg-plw-navy text-white shadow-sm shadow-black/30'
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
