import { FlaskConical } from 'lucide-react';
import { IS_DEMO_MODE } from '@/app/appConfig';

export function DemoDataNote() {
  if (!IS_DEMO_MODE) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-plw-gold/15 px-3 py-1 text-xs font-medium text-plw-gold-soft">
      <FlaskConical size={12} aria-hidden="true" />
      Datos de demostración
    </span>
  );
}
