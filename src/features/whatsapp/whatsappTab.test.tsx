import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { ServicesContext } from '@/app/ServicesContext';
import { createDemoServices } from '@/demo/createDemoServices';
import { CustomerWorkspace } from '@/features/customers/components/CustomerWorkspace';
import { NewWhatsAppChatDialog } from '@/features/whatsapp/components/NewWhatsAppChatDialog';

const requests: Record<string, unknown>[] = [];
let connected = true;
let windowOpen = true;

beforeEach(() => {
  requests.length = 0;
  connected = true;
  windowOpen = true;
});

// Stands in for the whatsapp function, which reads Chatwoot on the server.
vi.mock('@/integrations/supabase/callStaffFunction', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callStaffFunction: async (_name: string, sent: Record<string, unknown> | FormData) => {
    // A file goes up as a multipart form; record it as plain fields.
    const body = sent instanceof FormData ? Object.fromEntries(sent.entries()) : sent;
    requests.push(body);
    if (body.file instanceof File) {
      return {
        message: {
          id: '4',
          author: 'agent',
          body: body.text,
          sentAt: '2026-11-04T18:10:00Z',
          attachments: [{ kind: 'image', url: 'https://chat.example/menu.jpg' }],
        },
      };
    }
    switch (body.action) {
      case 'connect':
        connected = true;
        return { connected: true, sender: 'Alejandro Ruiz' };
      case 'start':
        return { prospectId: 'cliente-nuevo' };
      case 'templates':
        if (!connected) return { connected: false };
        return {
          templates: [
            {
              name: 'plw_seguimiento_solicitud_web',
              language: 'es',
              category: 'MARKETING',
              body: '¡Hola, {{1}}! Nos gustaría conocer más sobre su negocio de {{2}}.',
              params: ['1', '2'],
            },
          ],
        };
      case 'send':
      case 'send_template': {
        const text =
          typeof body.text === 'string'
            ? body.text
            : '¡Hola, María Fernanda Solís! Nos gustaría conocer más sobre su negocio de cafetería.';
        return {
          message: { id: '3', author: 'agent', body: text, sentAt: new Date().toISOString() },
        };
      }
      default:
        if (!connected) return { connected: false };
        return {
          connected: true,
          sender: 'Alejandro Ruiz',
          ambiguous: false,
          canReply: windowOpen,
          messages: [
            {
              id: '1',
              author: 'customer',
              body: 'Hola, ¿qué planes tienen?',
              sentAt: '2026-11-04T17:00:00Z',
              attachments: [{ kind: 'audio', url: 'https://chat.example/nota.ogg' }],
            },
            {
              id: '2',
              author: 'agent',
              body: 'Ya le cuento',
              sentAt: '2026-11-04T17:05:00Z',
              failed: true,
            },
          ],
        };
    }
  },
}));

async function openWhatsAppCustomer() {
  const services = createDemoServices(new Date());
  const [prospect] = await services.leads.listProspects();
  const conversation = (await services.inbox.listConversations(prospect.assignedAgentId)).find(
    (item) => item.prospectId === prospect.id
  );
  render(
    <ServicesContext.Provider value={services}>
      <MemoryRouter>
        <CustomerWorkspace
          entry={{
            prospect: { ...prospect, source: 'whatsapp' },
            conversation: conversation ?? null,
          }}
          agentId={prospect.assignedAgentId!}
          agentNames={{}}
        />
      </MemoryRouter>
    </ServicesContext.Provider>
  );
  return prospect;
}

test('a WhatsApp customer opens on the chat, keeps notes, and the agent answers from PLW', async () => {
  const prospect = await openWhatsAppCustomer();

  expect(screen.getByRole('tab', { name: 'WhatsApp' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('tab', { name: 'Correo' })).toBeNull();
  expect(await screen.findByText('Hola, ¿qué planes tienen?')).toBeTruthy();
  expect(document.querySelector('audio')?.getAttribute('src')).toBe(
    'https://chat.example/nota.ogg'
  );
  expect(screen.getByText(/No se entregó/)).toBeTruthy();
  expect(screen.getByText(/Respondes en Chatwoot como Alejandro Ruiz/)).toBeTruthy();
  // Stage and private notes still work for a WhatsApp customer; email replies do not apply.
  expect(screen.getByRole('tab', { name: /Nota privada/ })).toBeTruthy();
  expect(screen.queryByRole('tab', { name: /Respuesta por correo/ })).toBeNull();

  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Mensaje de WhatsApp'), 'Le paso la información');
  await user.click(screen.getByRole('button', { name: 'Enviar por WhatsApp' }));
  expect(await screen.findByText('Le paso la información')).toBeTruthy();
  expect(requests[requests.length - 1]).toEqual({
    action: 'send',
    prospectId: prospect.id,
    text: 'Le paso la información',
  });
});

test('an agent connects their own Chatwoot user once, then sees the chat', async () => {
  connected = false;
  await openWhatsAppCustomer();
  const user = userEvent.setup();

  const field = await screen.findByLabelText('Token de acceso de Chatwoot');
  expect(field.getAttribute('type')).toBe('password');
  await user.type(field, 'tok_alejandro_0000000001');
  await user.click(screen.getByRole('button', { name: 'Conectar' }));

  expect(await screen.findByText('Hola, ¿qué planes tienen?')).toBeTruthy();
  expect(requests).toContainEqual({ action: 'connect', token: 'tok_alejandro_0000000001' });
});

test('after 24 hours the agent reviews a template filled from the customer and sends it', async () => {
  windowOpen = false;
  const prospect = await openWhatsAppCustomer();
  const user = userEvent.setup();

  expect(await screen.findByText(/hasta que el cliente responda/)).toBeTruthy();
  expect(screen.queryByLabelText('Mensaje de WhatsApp')).toBeNull();
  await user.selectOptions(
    await screen.findByLabelText('Plantilla'),
    'plw seguimiento solicitud web (es)'
  );

  // Filled from the customer record; the agent can correct any value.
  expect((screen.getByLabelText('Dato 1') as HTMLInputElement).value).toBe('María Fernanda Solís');
  const business = screen.getByLabelText('Dato 2') as HTMLInputElement;
  expect(business.value).toBe('Alimentos y bebidas');
  await user.clear(business);
  const send = screen.getByRole('button', { name: 'Enviar plantilla' }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  await user.type(business, 'cafetería');
  expect(
    screen.getByText(
      '¡Hola, María Fernanda Solís! Nos gustaría conocer más sobre su negocio de cafetería.'
    )
  ).toBeTruthy();
  await user.click(send);

  expect(requests[requests.length - 1]).toEqual({
    action: 'send_template',
    prospectId: prospect.id,
    template: {
      name: 'plw_seguimiento_solicitud_web',
      language: 'es',
      values: { 1: 'María Fernanda Solís', 2: 'cafetería' },
    },
  });
  // The sent template joins the chat; the picker resets for another one.
  expect(
    await screen.findAllByText(
      '¡Hola, María Fernanda Solís! Nos gustaría conocer más sobre su negocio de cafetería.'
    )
  ).toHaveLength(1);
  expect((screen.getByLabelText('Plantilla') as HTMLSelectElement).value).toBe('-1');
});

test('the agent sends a photo with a caption, and it shows in the chat', async () => {
  const prospect = await openWhatsAppCustomer();
  const user = userEvent.setup();
  await screen.findByText('Hola, ¿qué planes tienen?');

  const photo = new File(['foto'], 'menu.jpg', { type: 'image/jpeg' });
  await user.upload(screen.getByLabelText('Archivo para enviar por WhatsApp'), photo);
  expect(screen.getByText('menu.jpg')).toBeTruthy();
  await user.type(screen.getByLabelText('Mensaje de WhatsApp'), 'Así quedaría su menú');
  await user.click(screen.getByRole('button', { name: 'Enviar por WhatsApp' }));

  const image = await screen.findByAltText('Foto enviada por WhatsApp');
  expect(image.getAttribute('src')).toBe('https://chat.example/menu.jpg');
  expect(requests[requests.length - 1]).toEqual({
    action: 'send',
    prospectId: prospect.id,
    text: 'Así quedaría su menú',
    file: photo,
  });
  // Ready for the next message.
  expect(screen.queryByText('menu.jpg')).toBeNull();
});

test('a file over WhatsApp’s limit is refused before uploading', async () => {
  await openWhatsAppCustomer();
  const user = userEvent.setup();
  await screen.findByText('Hola, ¿qué planes tienen?');

  const video = new File(['v'], 'demo.mp4', { type: 'video/mp4' });
  Object.defineProperty(video, 'size', { value: 17 * 1024 * 1024 });
  await user.upload(screen.getByLabelText('Archivo para enviar por WhatsApp'), video);

  expect(screen.getByText(/pesa más de 16 MB/).getAttribute('role')).toBe('alert');
  expect(screen.queryByText('demo.mp4')).toBeNull();
});

test('the chat reads like WhatsApp: the reply tab is pinned and a sent message glides into view', async () => {
  const scrollTo = vi.fn();
  Element.prototype.scrollTo = scrollTo;
  await openWhatsAppCustomer();
  const user = userEvent.setup();
  await screen.findByText('Hola, ¿qué planes tienen?');

  // WhatsApp and private notes share one timeline; their reply boxes are tabs below it.
  expect(
    screen.getByRole('tab', { name: 'Respuesta por WhatsApp' }).getAttribute('aria-selected')
  ).toBe('true');
  expect(screen.getByRole('tab', { name: /Nota privada/ })).toBeTruthy();

  await user.type(screen.getByLabelText('Mensaje de WhatsApp'), 'Le escribo en un momento');
  await user.click(screen.getByRole('button', { name: 'Enviar por WhatsApp' }));
  await screen.findByText('Le escribo en un momento');
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
});

test('an agent writes to a number from outside PLW with a reviewed template', async () => {
  const started = vi.fn();
  render(<NewWhatsAppChatDialog onClose={() => undefined} onStarted={started} />);
  const user = userEvent.setup();

  const phone = screen.getByLabelText('Número de WhatsApp');
  await user.type(phone, '8888 12');
  expect(screen.getByText(/Los 8 dígitos de Costa Rica/)).toBeTruthy();
  await user.type(phone, '34');
  expect(screen.getByText('Se enviará al +50688881234.')).toBeTruthy();
  await user.type(screen.getByLabelText('Nombre del cliente (opcional)'), 'Ana Mora');

  await user.selectOptions(
    await screen.findByLabelText('Plantilla'),
    'plw seguimiento solicitud web (es)'
  );
  expect((screen.getByLabelText('Dato 1') as HTMLInputElement).value).toBe('Ana Mora');
  await user.type(screen.getByLabelText('Dato 2'), 'cafetería');
  await user.click(screen.getByRole('button', { name: 'Enviar plantilla' }));

  expect(requests[requests.length - 1]).toEqual({
    action: 'start',
    phone: '+50688881234',
    name: 'Ana Mora',
    template: {
      name: 'plw_seguimiento_solicitud_web',
      language: 'es',
      values: { 1: 'Ana Mora', 2: 'cafetería' },
    },
  });
  expect(started).toHaveBeenCalledWith('cliente-nuevo');
});

test('a mistyped number is caught before anything is sent', async () => {
  render(<NewWhatsAppChatDialog onClose={() => undefined} onStarted={() => undefined} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Número de WhatsApp'), '1234');
  await user.selectOptions(
    await screen.findByLabelText('Plantilla'),
    'plw seguimiento solicitud web (es)'
  );
  await user.type(screen.getByLabelText('Dato 1'), 'Ana');
  await user.type(screen.getByLabelText('Dato 2'), 'cafetería');
  await user.click(screen.getByRole('button', { name: 'Enviar plantilla' }));

  expect((await screen.findByRole('alert')).textContent).toMatch(/Revisa el número/);
  expect(requests.some((request) => request.action === 'start')).toBe(false);
});

test('an agent without a WhatsApp customer yet connects Chatwoot from the new chat', async () => {
  connected = false;
  render(<NewWhatsAppChatDialog onClose={() => undefined} onStarted={() => undefined} />);
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText('Token de acceso de Chatwoot'),
    'tok_alejandro_0000000001'
  );
  await user.click(screen.getByRole('button', { name: 'Conectar' }));
  expect(await screen.findByLabelText('Plantilla')).toBeTruthy();
});
