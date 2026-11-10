import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useEnabledAgents } from '@/features/ai-outbound/hooks/useOutboundCampaigns';
import { startTestCall } from '@/features/ai-outbound/services/testCall';
import { toCostaRicaNumber } from '@/features/telephony/models/call';

interface TestCallDialogProps {
  open: boolean;
  onClose: () => void;
}

const NO_AGENT = '';

export function TestCallDialog({ open, onClose }: TestCallDialogProps) {
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [transferStaffId, setTransferStaffId] = useState(NO_AGENT);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const agents = useEnabledAgents();

  const normalizedPhone = toCostaRicaNumber(phone);
  const canSubmit = Boolean(normalizedPhone && businessName.trim() && businessType.trim()) && !saving;

  const reset = () => {
    setPhone('');
    setBusinessName('');
    setBusinessType('');
    setTransferStaffId(NO_AGENT);
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!normalizedPhone) {
      setError('Escribe un número de Costa Rica de 8 dígitos.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await startTestCall({
        phone: normalizedPhone,
        businessName: businessName.trim(),
        businessType: businessType.trim(),
        transferStaffId: transferStaffId || null,
      });
      setSuccess(`Llamando a ${normalizedPhone}. La llamada puede tardar unos segundos en sonar.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la llamada.');
    } finally {
      setSaving(false);
    }
  };

  const agentList = agents.state.status === 'ready' ? agents.state.data : [];

  return (
    <Dialog
      open={open}
      title="Llamada de prueba"
      description="El asistente llama a este número para presentar PLW y ofrecer una conversación con un agente."
      onClose={handleClose}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cerrar
          </Button>
          <Button type="submit" form="test-call-form" disabled={!canSubmit}>
            {saving ? 'Llamando...' : 'Llamar ahora'}
          </Button>
        </>
      }
    >
      <form id="test-call-form" className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField
          label="Número en Costa Rica"
          value={phone}
          inputMode="tel"
          maxLength={20}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="8888 8888"
          hint={
            phone && !normalizedPhone ? 'Debe tener 8 dígitos y empezar por 2 a 8.' : 'Puedes incluir +506.'
          }
          required
        />
        <TextField
          label="Nombre de la empresa"
          value={businessName}
          maxLength={160}
          onChange={(event) => setBusinessName(event.target.value)}
          required
        />
        <TextField
          label="Tipo de negocio"
          value={businessType}
          maxLength={120}
          onChange={(event) => setBusinessType(event.target.value)}
          placeholder="Ej. Barbería, taller mecánico, restaurante"
          required
        />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
          Agente que atiende la transferencia
          <select
            value={transferStaffId}
            onChange={(event) => setTransferStaffId(event.target.value)}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
          >
            <option value={NO_AGENT}>Sin agente por ahora</option>
            {agentList.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.display_name}
              </option>
            ))}
          </select>
        </label>
        {agents.state.status === 'error' ? (
          <StatusMessage tone="error" title={agents.state.message} />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="text-sm text-success-700">
            {success}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
