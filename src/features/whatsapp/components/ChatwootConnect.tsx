import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { connectChatwoot } from '@/features/whatsapp/hooks/useWhatsApp';

/** Each agent links their own Chatwoot user once, so their messages carry their own name. */
export function ChatwootConnect({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await connectChatwoot(token);
      setToken('');
      onConnected();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo conectar Chatwoot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
    >
      <p className="font-medium text-plw-ink">Conecta tu cuenta de Chatwoot</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
        <li>Entra a Chatwoot con tu propio usuario, no con el de otra persona.</li>
        <li>Abre tu foto (abajo a la izquierda) → Configuración del perfil.</li>
        <li>Copia el «Token de acceso» y pégalo aquí. Tus respuestas saldrán con tu nombre.</li>
      </ol>
      <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
        Token de acceso de Chatwoot
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="self-end" disabled={!token.trim() || saving}>
        {saving ? 'Verificando...' : 'Conectar'}
      </Button>
    </form>
  );
}
