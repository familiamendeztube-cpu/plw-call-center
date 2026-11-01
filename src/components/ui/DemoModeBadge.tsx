import { FlaskConical } from 'lucide-react';
import { IS_DEMO_MODE } from '@/app/appConfig';

export function DemoModeBadge() {
  if (!IS_DEMO_MODE) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-plw-gold-soft/60 bg-plw-gold-soft/15 px-2.5 py-1 text-xs font-medium text-plw-gold-soft"
      title="Los datos mostrados son ficticios"
    >
      <FlaskConical size={13} aria-hidden="true" />
      Modo demostración
    </span>
  );
}
