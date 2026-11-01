import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useAppServices } from '@/app/ServicesContext';
import { Button } from '@/components/ui/Button';
import type { OutboxStatus } from '@/features/inbox/models/reply';

interface ReplySendButtonProps {
  conversationId: string;
  disabled: boolean;
  body: string;
  flush: () => Promise<boolean>;
  onSent: (sentBody: string, status: OutboxStatus) => void;
}

const SEND_ERROR = 'No se pudo registrar el envío. Intenta de nuevo.';

export function ReplySendButton({
  conversationId,
  disabled,
  body,
  flush,
  onSent,
}: ReplySendButtonProps) {
  const { inbox } = useAppServices();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);

  const handleSend = async () => {
    if (sendingRef.current || disabled) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const sentBody = body;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      const saved = await flush();
      if (!saved) {
        setError('Guarda el borrador antes de enviar.');
        return;
      }
      const result = await inbox.requestSend(conversationId, requestId);
      requestIdRef.current = null;
      onSent(sentBody, result.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : SEND_ERROR);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
      <Button onClick={handleSend} disabled={disabled || sending}>
        <Send size={14} aria-hidden="true" />
        {sending ? 'Enviando...' : 'Enviar correo'}
      </Button>
    </div>
  );
}
