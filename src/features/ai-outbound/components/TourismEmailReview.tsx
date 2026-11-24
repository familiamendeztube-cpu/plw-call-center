import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CallRecording } from '@/features/ai-calls/components/AiCallCard';
import { getSupabaseClient } from '@/integrations/supabase/client';

interface Review {
  request_id: string;
  business: string;
  excerpt: string | null;
  start_seconds: number | null;
}

function ReviewRow({ row, onSaved }: { row: Review; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2 rounded-lg border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const result = await getSupabaseClient().rpc('verify_tourism_email', {
            p_request: row.request_id,
            p_email: email.trim(),
          });
          if (result.error) throw result.error;
          onSaved();
        } catch {
          setError('No se pudo guardar. Puede volver a intentarlo.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>{row.business}</strong>
      {row.excerpt && <p>{row.excerpt}</p>}
      <CallRecording
        target={{ requestId: row.request_id }}
        startSeconds={row.start_seconds ?? undefined}
      />
      <label>
        Correo que verificó en la grabación
        <input
          className="block w-full rounded border p-2"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <Button type="submit" disabled={busy || !email.trim()}>
        Guardar correo verificado
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function TourismEmailReview() {
  const [rows, setRows] = useState<Review[]>([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getSupabaseClient().rpc('pending_tourism_emails');
        if (result.error) throw result.error;
        if (active) {
          setRows(result.data ?? []);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [revision]);
  if (error)
    return (
      <Button onClick={() => setRevision(revision + 1)}>
        Reintentar carga de correos pendientes
      </Button>
    );
  if (!rows.length) return null;
  return (
    <section className="grid gap-3">
      <h2>Correos pendientes de confirmar</h2>
      {rows.map((row) => (
        <ReviewRow
          key={row.request_id}
          row={row}
          onSaved={() => {
            setRows((current) => current.filter((item) => item.request_id !== row.request_id));
            setRevision((current) => current + 1);
          }}
        />
      ))}
    </section>
  );
}
