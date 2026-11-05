import {
  decryptRefreshToken as decryptSecret,
  encryptRefreshToken as encryptSecret,
} from '../google-workspace/tokenCrypto.js';
import {
  chatMessage,
  chatwootIdentity,
  CONNECT_ERRORS,
  MAX_CAPTION,
  renderTemplate,
  sendableTemplates,
  whatsAppFile,
  whatsAppNumber,
} from '../chatwoot-webhook/rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const STAFF_ID = /^(agent|admin)-[0-9]+$/;
const MAX_TEXT = 4096; // WhatsApp's limit for one text message.
const UNIQUE_VIOLATION = '23505';
const NOT_CONNECTED = 'Conecta tu cuenta de Chatwoot para responder por WhatsApp.';
const EXPIRED = 'Tu conexión con Chatwoot ya no es válida. Conéctala de nuevo.';
const BAD_NUMBER =
  'Escribe un número de WhatsApp válido: los 8 dígitos de Costa Rica, o + y el código del país.';
const NOT_YOURS =
  'Ese número es de un cliente que no tienes asignado. Pídele a un administrador que te lo asigne.';

const reply = (status, body) => ({ status, body });
const readJson = (response) => response.json().catch(() => null);

/**
 * One request from a signed-in staff member.
 * - staff: from the verified session, never from the body.
 * - admin: service-role client, for the encrypted tokens.
 * - db: the caller's own client; row-level security decides which chats they can open.
 * - chatwoot(path, token, init): calls Chatwoot with the given user's token.
 */
export async function handleWhatsApp({ staff, body, admin, db, chatwoot, config }) {
  const { account, inbox, tokenKey } = config;
  const accounts = () => admin.from('chatwoot_agent_accounts');

  if (body.action === 'list_connections') {
    if (staff.role !== 'admin') return reply(403, { error: 'No autorizado.' });
    const { data, error } = await accounts()
      .select('staff_id, chatwoot_user_id, chatwoot_name, chatwoot_email, connected_at')
      .order('staff_id');
    if (error) throw error;
    return reply(200, {
      connections: data.map((row) => ({
        staffId: row.staff_id,
        chatwootUserId: row.chatwoot_user_id,
        name: row.chatwoot_name,
        email: row.chatwoot_email,
        connectedAt: row.connected_at,
      })),
    });
  }

  if (body.action === 'disconnect') {
    // Agents disconnect only themselves; an administrator can disconnect anyone.
    const target = staff.role === 'admin' ? body.staffId : staff.staffId;
    if (typeof target !== 'string' || !STAFF_ID.test(target)) {
      return reply(400, { error: 'Solicitud no válida.' });
    }
    const { error } = await accounts().delete().eq('staff_id', target);
    if (error) throw error;
    return reply(200, { connected: false });
  }

  if (staff.role !== 'agent') {
    return reply(403, { error: 'Solo los agentes responden por WhatsApp desde PLW.' });
  }

  if (body.action === 'connect') {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!TOKEN.test(token)) return reply(400, { error: CONNECT_ERRORS.invalid });
    // Chatwoot says whose token it is; PLW never takes a Chatwoot user id from the browser.
    const [profile, inboxes] = await Promise.all([
      chatwoot('/api/v1/profile', token),
      chatwoot(`/api/v1/accounts/${account}/inboxes`, token),
    ]);
    if (profile?.status === 401) return reply(400, { error: CONNECT_ERRORS.invalid });
    if (!profile?.ok || !inboxes?.ok) {
      console.error('whatsapp connect', profile?.status ?? 'network', inboxes?.status ?? 'network');
      return reply(502, { error: 'No se pudo verificar el token con Chatwoot. Intente de nuevo.' });
    }
    const result = chatwootIdentity(await readJson(profile), await readJson(inboxes), account, inbox);
    if (!result.identity) return reply(400, { error: CONNECT_ERRORS[result.error] });
    const { error } = await accounts().upsert(
      {
        staff_id: staff.staffId,
        chatwoot_user_id: result.identity.userId,
        chatwoot_name: result.identity.name,
        chatwoot_email: result.identity.email,
        token_ciphertext: await encryptSecret(token, tokenKey),
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'staff_id' }
    );
    if (error?.code === UNIQUE_VIOLATION) {
      return reply(409, { error: 'Ese usuario de Chatwoot ya está conectado a otro agente de PLW.' });
    }
    if (error) throw error;
    return reply(200, { connected: true, sender: result.identity.name });
  }

  const action = body.action;
  const forChat = action === 'load' || action === 'send' || action === 'send_template';
  if (!forChat && action !== 'templates' && action !== 'start') {
    return reply(400, { error: 'Acción no válida.' });
  }
  // Reading actions answer "not connected" so the page can offer to connect; writes refuse.
  const quiet = action === 'load' || action === 'templates';

  let chat = null;
  let prospectId = '';
  if (forChat) {
    prospectId = typeof body.prospectId === 'string' ? body.prospectId : '';
    if (!UUID.test(prospectId)) return reply(400, { error: 'Solicitud no válida.' });
    // ponytail: shows the customer's latest Chatwoot conversation only; list older ones if agents need them.
    const { data, error } = await db
      .from('whatsapp_chats')
      .select('chatwoot_conversation_id, ambiguous_match')
      .eq('prospect_id', prospectId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return reply(401, { error: 'Sesión no válida.' });
    // Same answer for "does not exist" and "not yours". The conversation id comes from PLW only.
    if (!data) return reply(404, { error: 'Este cliente no tiene chat de WhatsApp.' });
    chat = data;
  }

  // The caller's own Chatwoot user, so the message carries their own name.
  const { data: mine, error: mineError } = await accounts()
    .select('chatwoot_name, token_ciphertext')
    .eq('staff_id', staff.staffId)
    .maybeSingle();
  if (mineError) throw mineError;
  if (!mine) return quiet ? reply(200, { connected: false }) : reply(409, { error: NOT_CONNECTED });
  const token = await decryptSecret(mine.token_ciphertext, tokenKey);
  // A token reset or revoked in Chatwoot: forget it, so the agent is asked to connect again.
  const expired = async () => {
    const { error } = await accounts().delete().eq('staff_id', staff.staffId);
    if (error) throw error;
    return quiet ? reply(200, { connected: false }) : reply(409, { error: EXPIRED });
  };

  const accountPath = `/api/v1/accounts/${account}`;
  const conversationPath = (id) => `${accountPath}/conversations/${id}`;
  const templatesPath = `${accountPath}/inboxes/${inbox}/message_templates`;
  const postJson = (value) => ({ method: 'POST', body: JSON.stringify(value) });
  const SEND_FAILED = reply(502, { error: 'No se pudo enviar el mensaje. Intente de nuevo.' });

  const post = async (conversationId, message) => {
    const sent = await chatwoot(`${conversationPath(conversationId)}/messages`, token, {
      method: 'POST',
      body: message instanceof FormData ? message : JSON.stringify(message),
    });
    if (sent?.status === 401) return expired();
    if (!sent?.ok) {
      console.error('whatsapp send', sent?.status ?? 'network');
      return SEND_FAILED;
    }
    return reply(200, { message: chatMessage(await readJson(sent)) });
  };

  // The approved templates Chatwoot synced from WhatsApp, read fresh on every request, so the
  // language code and the text are always Meta's own.
  const loadTemplates = async (name) => {
    const path = name ? `${templatesPath}?name=${encodeURIComponent(name)}` : templatesPath;
    const response = await chatwoot(path, token);
    if (response?.status === 401) return 'expired';
    if (!response?.ok) {
      console.error('whatsapp templates', response?.status ?? 'network');
      return null;
    }
    return sendableTemplates((await readJson(response))?.payload);
  };
  const TEMPLATES_FAILED = reply(502, { error: 'No se pudieron cargar las plantillas de Chatwoot.' });

  // The message for the template the agent picked. Its text and category come from Chatwoot, never
  // from the browser.
  const templateMessage = async (picked) => {
    const { name, language, values } = picked ?? {};
    if (typeof name !== 'string' || typeof language !== 'string') {
      return { failed: reply(400, { error: 'Solicitud no válida.' }) };
    }
    const templates = await loadTemplates(name);
    if (templates === 'expired') return { failed: await expired() };
    if (!templates) return { failed: TEMPLATES_FAILED };
    const template = templates.find((item) => item.name === name && item.language === language);
    if (!template) {
      return { failed: reply(400, { error: 'Esa plantilla ya no está disponible en Chatwoot.' }) };
    }
    const message = renderTemplate(template, values);
    if (!message) return { failed: reply(400, { error: 'Completa todos los datos de la plantilla.' }) };
    return { message };
  };

  // The Chatwoot contact with this number, or a new one under the name the agent typed.
  const findOrCreateContact = async (phone, name) => {
    const found = await chatwoot(`${accountPath}/contacts/search?q=${encodeURIComponent(phone)}`, token);
    if (found?.status === 401) return 'expired';
    if (!found?.ok) return null;
    const list = (await readJson(found))?.payload;
    const existing = Array.isArray(list) ? list.find((contact) => contact?.phone_number === phone) : null;
    if (Number.isInteger(existing?.id)) return existing.id;
    const created = await chatwoot(
      `${accountPath}/contacts`,
      token,
      postJson({ name: name || phone, phone_number: phone })
    );
    if (created?.status === 401) return 'expired';
    if (!created?.ok) return null;
    const id = (await readJson(created))?.payload?.contact?.id;
    return Number.isInteger(id) ? id : null;
  };

  switch (action) {
    case 'load': {
      // ponytail: Chatwoot returns the latest 20 messages; page with ?before= if agents need more history.
      const path = conversationPath(chat.chatwoot_conversation_id);
      const [conversation, messages] = await Promise.all([
        chatwoot(path, token),
        chatwoot(`${path}/messages`, token),
      ]);
      if (conversation?.status === 401 || messages?.status === 401) return expired();
      if (!conversation?.ok || !messages?.ok) {
        console.error('whatsapp load', conversation?.status ?? 'network', messages?.status ?? 'network');
        return reply(502, { error: 'No se pudo cargar el chat de WhatsApp. Intente de nuevo.' });
      }
      const info = await readJson(conversation);
      const list = await readJson(messages);
      const { error: readError } = await db.rpc('mark_whatsapp_read', { p_prospect_id: prospectId });
      if (readError) console.error('whatsapp mark_read', readError.code);
      return reply(200, {
        connected: true,
        sender: mine.chatwoot_name,
        ambiguous: chat.ambiguous_match === true,
        // Chatwoot knows each channel's reply window (24 hours for the WhatsApp Business API).
        canReply: info?.can_reply !== false,
        messages: (Array.isArray(list?.payload) ? list.payload : []).map(chatMessage).filter(Boolean),
      });
    }
    case 'templates': {
      const templates = await loadTemplates();
      if (templates === 'expired') return expired();
      return templates ? reply(200, { connected: true, templates }) : TEMPLATES_FAILED;
    }
    case 'send_template': {
      const { message, failed } = await templateMessage(body.template);
      return failed ?? post(chat.chatwoot_conversation_id, message);
    }
    case 'start': {
      const phone = whatsAppNumber(body.phone);
      if (!phone) return reply(400, { error: BAD_NUMBER });
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
      const { message, failed } = await templateMessage(body.template);
      if (failed) return failed;

      // PLW picks the customer before anything goes out, so no agent writes to another's customer.
      const { data: target, error } = await admin
        .rpc('start_whatsapp_customer', { p_agent: staff.staffId, p_phone: phone, p_name: name })
        .maybeSingle();
      if (error) throw error;
      if (!target) return reply(409, { error: NOT_YOURS });

      let conversationId = target.conversation;
      if (conversationId) {
        // The customer already has a chat: the template goes there.
        const sent = await post(conversationId, message);
        if (sent.status !== 200) return sent;
      } else {
        const contactId = await findOrCreateContact(phone, name);
        if (contactId === 'expired') return expired();
        if (!contactId) {
          console.error('whatsapp start contact');
          return SEND_FAILED;
        }
        // WhatsApp identifies the chat by the number without the +.
        const created = await chatwoot(
          `${accountPath}/conversations`,
          token,
          postJson({ inbox_id: Number(inbox), contact_id: contactId, source_id: phone.slice(1), message })
        );
        if (created?.status === 401) return expired();
        if (!created?.ok) {
          console.error('whatsapp start', created?.status ?? 'network');
          return SEND_FAILED;
        }
        conversationId = (await readJson(created))?.id;
        if (!Number.isInteger(conversationId)) throw new Error('chatwoot_conversation_id');
      }
      const { error: linkError } = await admin.rpc('link_whatsapp_chat', {
        p_conversation_id: conversationId,
        p_prospect_id: target.customer,
      });
      if (linkError) throw linkError;
      return reply(200, { prospectId: target.customer });
    }
    case 'send': {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (body.file !== undefined && body.file !== null) {
        const file = body.file;
        if (typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
          return reply(400, { error: 'Solicitud no válida.' });
        }
        const media = whatsAppFile(file.name, file.size);
        if (media.error) return reply(400, { error: media.error });
        if (text.length > MAX_CAPTION) {
          return reply(400, {
            error: `El texto que acompaña un archivo puede tener hasta ${MAX_CAPTION} caracteres.`,
          });
        }
        // Chatwoot takes files as a multipart upload; the text goes out as the caption.
        const form = new FormData();
        if (text) form.append('content', text);
        form.append('message_type', 'outgoing');
        form.append('private', 'false');
        form.append('attachments[]', new File([file], file.name, { type: media.type }));
        return post(chat.chatwoot_conversation_id, form);
      }
      if (!text || text.length > MAX_TEXT) {
        return reply(400, { error: `Escribe un mensaje de hasta ${MAX_TEXT} caracteres.` });
      }
      return post(chat.chatwoot_conversation_id, { content: text, message_type: 'outgoing', private: false });
    }
  }
}
