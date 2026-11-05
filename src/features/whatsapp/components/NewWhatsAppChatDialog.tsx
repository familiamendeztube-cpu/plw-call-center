import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { TemplateComposer } from '@/features/whatsapp/components/TemplateComposer';
import { startWhatsAppChat, whatsAppNumber } from '@/features/whatsapp/hooks/useWhatsApp';

const NUMBER_HINT = 'Los 8 dígitos de Costa Rica, o + y el código de otro país.';

interface NewWhatsAppChatDialogProps {
  onClose: () => void;
  /** The customer the chat joined: the agent's own with that number, or a new one. */
  onStarted: (prospectId: string) => void;
}

/** Writes to a number that came from outside PLW, as Chatwoot's "new conversation" does. */
export function NewWhatsAppChatDialog({ onClose, onStarted }: NewWhatsAppChatDialogProps) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const number = whatsAppNumber(phone);

  return (
    <Dialog
      open
      title="Nuevo chat de WhatsApp"
      description="Escríbele a un número con una plantilla aprobada. Si ya es tu cliente, el chat se une a su ficha; si no, se crea un cliente nuevo a tu nombre."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Número de WhatsApp"
            type="tel"
            autoComplete="off"
            value={phone}
            maxLength={40}
            onChange={(event) => setPhone(event.target.value)}
            hint={number ? `Se enviará al ${number}.` : NUMBER_HINT}
          />
          <TextField
            label="Nombre del cliente (opcional)"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <TemplateComposer
          prospect={{ contactName: name, businessCategory: '' }}
          onSend={async ({ template }) => {
            if (!number) throw new Error(`Revisa el número. ${NUMBER_HINT}`);
            onStarted(await startWhatsAppChat({ phone: number, name: name.trim(), template }));
          }}
        />
      </div>
    </Dialog>
  );
}
