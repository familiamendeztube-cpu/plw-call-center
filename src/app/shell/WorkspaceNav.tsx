import { NavLink } from 'react-router-dom';
import { cx } from '@/components/ui/cx';
import type { NavItem } from '@/app/shell/navigation';

interface WorkspaceNavProps {
  items: NavItem[];
  label: string;
}

export function WorkspaceNav({ items, label }: WorkspaceNavProps) {
  return (
    <nav aria-label={label} className="overflow-x-auto bg-plw-navy scrollbar-thin">
      <ul className="flex min-w-max gap-1 px-4 sm:px-6 lg:px-8">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'relative flex h-12 items-center whitespace-nowrap rounded-t-md px-3 text-sm font-medium',
                  'transition-colors duration-150 focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-plw-gold-soft focus-visible:ring-inset',
                  isActive
                    ? 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-plw-gold-soft'
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
