import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import type { Agent, AgentId } from '@/features/auth/models/agent';
import { DEMO_AGENT_PIN, PIN_LENGTH } from '@/features/auth/models/demoAccess';
import { AgentCardSelector } from '@/features/auth/components/AgentCardSelector';
import { DeviceEnrollmentPanel } from '@/features/auth/components/DeviceEnrollmentPanel';
import { PinKeypad } from '@/features/auth/components/PinKeypad';
import { BrandPanel } from '@/features/auth/components/BrandPanel';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';

interface LoginScreenProps {
  agents: Agent[];
  notice: string | null;
  deviceRequired: boolean;
  onSignIn: (agentId: AgentId, pin: string) => Promise<string | null>;
  onEnrollDevice: (code: string, label: string) => Promise<string | null>;
}

export function LoginScreen({
  agents,
  notice,
  deviceRequired,
  onSignIn,
  onEnrollDevice,
}: LoginScreenProps) {
  const [selectedId, setSelectedId] = useState<AgentId | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDigit = useCallback((digit: string) => {
    setError(null);
    setPin((current) => (current.length < PIN_LENGTH ? `${current}${digit}` : current));
  }, []);

  const handleDelete = useCallback(() => {
    setPin((current) => current.slice(0, -1));
  }, []);

  const submit = useCallback(
    async (agentId: AgentId, enteredPin: string) => {
      setSubmitting(true);
      setError(null);
      const message = await onSignIn(agentId, enteredPin);
      setSubmitting(false);
      setError(message);
      setPin('');
    },
    [onSignIn]
  );

  // Works in either order: the last digit or the agent can come second.
  useEffect(() => {
    if (selectedId !== null && pin.length === PIN_LENGTH && !submitting) {
      void submit(selectedId, pin);
    }
  }, [selectedId, pin, submitting, submit]);

  const selectedAgent = agents.find((agent) => agent.id === selectedId);
  const shownError = error ?? (deviceRequired ? null : notice);

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <main className="flex items-center justify-center px-4 py-10 sm:px-8 lg:py-14">
        <div className="w-full max-w-xl animate-fade-in">
          <div className="glass-panel-strong rounded-2xl p-6 shadow-raised sm:p-8">
            <header className="mb-6">
              <h2 className="text-xl font-semibold text-plw-ink">Ingreso de agentes</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Selecciona tu agente e ingresa tu PIN de cuatro dígitos.
              </p>
            </header>

            {agents.length === 0 ? (
              <StatusMessage tone="error" title="No hay agentes disponibles para ingresar." />
            ) : (
              <AgentCardSelector
                agents={agents}
                selectedId={selectedId}
                onSelect={setSelectedId}
                disabled={submitting}
              />
            )}

            <div className="mt-8 flex flex-col items-center gap-6">
              <PinKeypad
                value={pin}
                onDigit={handleDigit}
                onDelete={handleDelete}
                disabled={submitting}
              />
              {shownError ? (
                <p role="alert" className="text-center text-sm font-medium text-danger-700">
                  {shownError}
                </p>
              ) : null}
            </div>

            {deviceRequired ? (
              <div className="mt-6">
                <DeviceEnrollmentPanel onEnroll={onEnrollDevice} />
              </div>
            ) : null}

            {IS_DEMO_MODE ? (
              <div className="mt-8 rounded-xl border border-dashed border-plw-gold/50 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-plw-gold-soft">
                  <FlaskConical size={16} aria-hidden="true" className="text-plw-gold" />
                  Acceso de demostración
                </div>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                  Usa datos ficticios. El PIN de demostración es {DEMO_AGENT_PIN}.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  disabled={!selectedAgent || submitting}
                  onClick={() => selectedAgent && submit(selectedAgent.id, DEMO_AGENT_PIN)}
                >
                  {selectedAgent
                    ? `Entrar en demostración como ${selectedAgent.displayName}`
                    : 'Selecciona un agente para entrar en demostración'}
                </Button>
              </div>
            ) : null}

            <div className="mt-6 flex justify-center border-t border-neutral-200 pt-6">
              <Link
                to="/acceso-administrador"
                className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-plw-gold-soft transition-colors hover:text-white"
              >
                Acceso de administrador
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
