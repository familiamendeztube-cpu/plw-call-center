import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/features/auth/context/useAuth';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { ConnectionStatus } from '@/features/telephony/components/ConnectionStatus';
import { PhoneScreen } from '@/features/telephony/components/PhoneScreen';
import { CallControls } from '@/features/telephony/components/CallControls';
import { InCallKeypad } from '@/features/telephony/components/InCallKeypad';
import { PhoneCustomerActions } from '@/features/telephony/components/PhoneCustomerActions';
import { RecentCallsList } from '@/features/telephony/components/RecentCallsList';
import { AudioSettingsButton } from '@/features/telephony/components/AudioSettingsButton';
import { PhoneAvailabilityToggle } from '@/features/presence/components/PhoneAvailabilityToggle';

export function PhonePanel() {
  const { session } = useAuth();
  const { connectorStatus, commandError } = useTelephony();

  return (
    <section
      aria-label="Teléfono"
      className="flex h-full min-h-0 flex-col bg-neutral-100 p-3 sm:p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.25rem] border-[7px] border-plw-deep bg-white shadow-panel">
        <header className="flex flex-col items-center gap-1 border-b border-neutral-200 px-5 pb-3 pt-4">
          <span aria-hidden="true" className="h-1.5 w-16 rounded-full bg-neutral-300" />
          <h2 className="pt-1 text-sm font-semibold text-plw-ink">Teléfono</h2>
          <ConnectionStatus status={connectorStatus} />
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
          {connectorStatus === 'pending_configuration' ? (
            <div className="flex gap-3 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5 text-xs leading-relaxed text-warning-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                Las llamadas se habilitarán cuando la línea telefónica esté conectada. Mientras
                tanto puedes preparar el número.
              </p>
            </div>
          ) : null}

          {session?.role === 'agent' ? <PhoneAvailabilityToggle /> : null}
          <PhoneScreen />
          <CallControls />
          <InCallKeypad />

          {commandError ? (
            <p role="alert" className="text-xs font-medium text-danger-700">
              {commandError}
            </p>
          ) : null}

          <PhoneCustomerActions />

          <section aria-labelledby="recent-calls-title" className="flex flex-col gap-2">
            <h3
              id="recent-calls-title"
              className="text-xs font-semibold uppercase tracking-wider text-neutral-500"
            >
              Llamadas recientes
            </h3>
            <RecentCallsList />
          </section>
        </div>

        <footer className="border-t border-neutral-200 px-5 py-3">
          <AudioSettingsButton />
        </footer>
      </div>
    </section>
  );
}
