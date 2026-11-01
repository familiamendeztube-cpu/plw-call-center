import { Settings2 } from 'lucide-react';
import { PlwWordmark } from '@/components/ui/PlwWordmark';
import { Panel } from '@/components/ui/Panel';

interface SetupRequiredScreenProps {
  missingKeys: string[];
  modeUnset: boolean;
}

export function SetupRequiredScreen({ missingKeys, modeUnset }: SetupRequiredScreenProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-plw-deep px-4 py-12">
      <div className="mb-8">
        <PlwWordmark tone="light" />
      </div>
      <Panel className="w-full max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-plw-ivory text-plw-gold">
          <Settings2 size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-plw-ink">Configuración pendiente</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          La autenticación real de PLW Call Center aún no está configurada. Por seguridad, el acceso
          permanece cerrado hasta completar la configuración.
        </p>
        {missingKeys.length > 0 ? (
          <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-left">
            <p className="text-sm font-medium text-plw-ink">Variables que faltan:</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-neutral-700">
              {missingKeys.map((key) => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {modeUnset ? (
          <p className="mt-6 text-sm leading-relaxed text-neutral-600">
            El modo de acceso no está definido. Defina VITE_PLW_AUTH_MODE como{' '}
            <span className="font-mono text-xs">production</span> o{' '}
            <span className="font-mono text-xs">demo</span>.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
