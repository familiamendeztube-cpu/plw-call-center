import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatMessage,
  messageFromEvent,
  renderTemplate,
  sendableTemplates,
  verifySignature,
  whatsAppFile,
} from '../supabase/functions/chatwoot-webhook/rules.js';

const SECRET = 'cw_test_secret_for_fixture_only';
const NOW = 1793750500;
const INBOX = '7';

// Shaped like Chatwoot's message_created webhook (Message#webhook_data).
const incoming = (overrides = {}) => ({
  event: 'message_created',
  id: 901,
  content: 'Hola, quiero información',
  message_type: 'incoming',
  private: false,
  sender: { id: 5, name: 'Ana Mora', phone_number: '+50688887777', type: 'contact' },
  conversation: { id: 31, inbox_id: 7, meta: { sender: { name: 'Ana Mora', phone_number: '+50688887777' } } },
  inbox: { id: 7, name: 'WhatsApp PLW' },
  ...overrides,
});

const body = JSON.stringify(incoming());
const sign = (raw, at = NOW, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')}`;

test('accepts a delivery signed the way Chatwoot signs it', async () => {
  assert.equal(await verifySignature(sign(body), String(NOW), body, SECRET, NOW), true);
});

test('rejects tampered bodies, wrong secrets, stale or future times and bad headers', async () => {
  const good = sign(body);
  assert.equal(await verifySignature(good, String(NOW), body.replace('Hola', 'Adiós'), SECRET, NOW), false);
  assert.equal(await verifySignature(sign(body, NOW, 'other_secret_value'), String(NOW), body, SECRET, NOW), false);
  assert.equal(await verifySignature(sign(body, NOW - 1801), String(NOW - 1801), body, SECRET, NOW), false);
  assert.equal(await verifySignature(sign(body, NOW + 301), String(NOW + 301), body, SECRET, NOW), false);
  // The timestamp is part of what is signed: changing it alone breaks the signature.
  assert.equal(await verifySignature(good, String(NOW - 1), body, SECRET, NOW), false);
  for (const header of [null, '', good.slice(7), `sha256=${'z'.repeat(64)}`]) {
    assert.equal(await verifySignature(header, String(NOW), body, SECRET, NOW), false);
  }
  assert.equal(await verifySignature(good, null, body, SECRET, NOW), false);
  assert.equal(await verifySignature(good, String(NOW), body, '', NOW), false);
});

test('a customer message in the WhatsApp inbox becomes a chat to record', () => {
  assert.deepEqual(messageFromEvent(incoming(), INBOX), {
    chat: { conversationId: 31, phone: '+50688887777', name: 'Ana Mora' },
  });
  // A contact without a name is still recorded by number.
  const unnamed = incoming({ sender: { id: 5, phone_number: '+50688887777', type: 'contact' } });
  assert.deepEqual(messageFromEvent(unnamed, INBOX).chat.name, '');
});

test('agent replies, notes, other inboxes and other events never touch PLW', () => {
  assert.deepEqual(messageFromEvent(incoming({ message_type: 'outgoing' }), INBOX), { ignore: 'not_incoming' });
  assert.deepEqual(messageFromEvent(incoming({ message_type: 'activity' }), INBOX), { ignore: 'not_incoming' });
  assert.deepEqual(messageFromEvent(incoming({ private: true }), INBOX), { ignore: 'private' });
  assert.deepEqual(messageFromEvent(incoming({ event: 'conversation_created' }), INBOX), { ignore: 'event' });
  const webChat = incoming({ conversation: { id: 31, inbox_id: 2 }, inbox: { id: 2 } });
  assert.deepEqual(messageFromEvent(webChat, INBOX), { ignore: 'other_inbox' });
});

test('flags deliveries PLW cannot use', () => {
  assert.deepEqual(messageFromEvent(null, INBOX), { invalid: 'malformed' });
  const noId = incoming({ conversation: { id: '31', inbox_id: 7 } });
  assert.deepEqual(messageFromEvent(noId, INBOX), { invalid: 'no_conversation' });
  const noPhone = incoming({ sender: { id: 5, name: 'Ana', type: 'contact' }, conversation: { id: 31, inbox_id: 7 } });
  assert.deepEqual(messageFromEvent(noPhone, INBOX), { invalid: 'no_phone' });
});

test('shows customer and agent messages with their files, and hides notes and activity', () => {
  assert.deepEqual(
    chatMessage({
      id: 11,
      content: ' Mire la foto ',
      message_type: 0,
      created_at: NOW,
      attachments: [
        { file_type: 'image', data_url: 'https://chat.example/rails/blob/1.jpg' },
        { file_type: 'image', data_url: 'javascript:alert(1)' },
      ],
    }),
    {
      id: '11',
      author: 'customer',
      body: 'Mire la foto',
      sentAt: new Date(NOW * 1000).toISOString(),
      failed: false,
      attachments: [{ kind: 'image', url: 'https://chat.example/rails/blob/1.jpg' }],
    }
  );
  const failed = chatMessage({ id: 12, content: 'Hola', message_type: 1, created_at: NOW, status: 'failed' });
  assert.equal(failed.author, 'agent');
  assert.equal(failed.failed, true);
  assert.equal(chatMessage({ id: 13, content: 'Nota interna', message_type: 1, private: true }), null);
  assert.equal(chatMessage({ id: 14, content: 'Conversación resuelta', message_type: 2 }), null);
  assert.equal(chatMessage({ id: 15, content: '', message_type: 0 }), null);
});

// Shaped like the WhatsApp Cloud templates Chatwoot caches for an inbox.
const followUp = {
  name: 'seguimiento_llamada',
  language: 'es',
  category: 'UTILITY',
  status: 'APPROVED',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'PLW' },
    { type: 'BODY', text: 'Hola {{1}}, soy {{2}} de PLW. ¿Le sirve que hablemos {{1}}?' },
    { type: 'FOOTER', text: 'Responda STOP para no recibir mensajes' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sí' }] },
  ],
};

test('offers only approved templates whose blanks are all in the body', () => {
  const named = {
    ...followUp,
    name: 'bienvenida',
    components: [{ type: 'BODY', text: 'Hola {{customer_name}}' }],
  };
  const pending = { ...followUp, name: 'pendiente', status: 'PENDING' };
  const photo = {
    ...followUp,
    name: 'con_foto',
    components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Mire' }],
  };
  const code = {
    ...followUp,
    name: 'codigo',
    components: [{ type: 'BODY', text: 'Su código' }, { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE' }] }],
  };
  const link = {
    ...followUp,
    name: 'enlace',
    components: [
      { type: 'BODY', text: 'Vea' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://plw.test/{{1}}' }] },
    ],
  };
  assert.deepEqual(sendableTemplates([followUp, named, pending, photo, code, link]), [
    {
      name: 'seguimiento_llamada',
      language: 'es',
      category: 'UTILITY',
      body: 'Hola {{1}}, soy {{2}} de PLW. ¿Le sirve que hablemos {{1}}?',
      params: ['1', '2'],
    },
    { name: 'bienvenida', language: 'es', category: 'UTILITY', body: 'Hola {{customer_name}}', params: ['customer_name'] },
  ]);
  assert.deepEqual(sendableTemplates(null), []);
});

test('fills every blank, flattens line breaks WhatsApp refuses, and needs all of them', () => {
  const [template] = sendableTemplates([followUp]);
  assert.deepEqual(renderTemplate(template, { 1: ' Ana\nMora ', 2: 'Luis' }), {
    content: 'Hola Ana Mora, soy Luis de PLW. ¿Le sirve que hablemos Ana Mora?',
    message_type: 'outgoing',
    private: false,
    template_params: {
      name: 'seguimiento_llamada',
      category: 'UTILITY',
      language: 'es',
      processed_params: { body: { 1: 'Ana Mora', 2: 'Luis' } },
    },
  });
  assert.equal(renderTemplate(template, { 1: 'Ana' }), null);
  assert.equal(renderTemplate(template, { 1: 'Ana', 2: '   ' }), null);
  assert.equal(renderTemplate(template, { 1: 'Ana', 2: 7 }), null);
});

test('accepts the files WhatsApp takes, within its own size limits', () => {
  const MB = 1024 * 1024;
  assert.deepEqual(whatsAppFile('Foto.JPG', 2 * MB), { type: 'image/jpeg' });
  assert.deepEqual(whatsAppFile('demo.mp4', 15 * MB), { type: 'video/mp4' });
  assert.deepEqual(whatsAppFile('nota.ogg', MB), { type: 'audio/ogg' });
  // The extension decides: Windows browsers often leave Office files without a type.
  assert.deepEqual(whatsAppFile('propuesta.final.docx', MB), {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.match(whatsAppFile('captura.png', 6 * MB).error, /5 MB/);
  assert.match(whatsAppFile('video.mp4', 17 * MB).error, /16 MB/);
  assert.match(whatsAppFile('programa.exe', MB).error, /no acepta/);
  assert.match(whatsAppFile('sin_extension', MB).error, /no acepta/);
  assert.match(whatsAppFile('vacio.pdf', 0).error, /vacío/);
});
