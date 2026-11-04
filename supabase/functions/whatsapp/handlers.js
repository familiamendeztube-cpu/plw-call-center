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
} from '../chatwoot-webhook/rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const STAFF_ID = /^(agent|admin)-[0-9]+$/;
const MAX_TEXT = 4096; // WhatsApp's limit for one text message.
const UNIQUE_VIOLATION = '23505';
const NOT_CONNECTED = 'Conecta tu cuenta de Chatwoot para responder por WhatsApp.';
const EXPIRED = 'Tu conexión con Chatwoot ya no es válida. Conéctala de nuevo.';

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

  const prospectId = typeof body.prospectId === 'string' ? body.prospectId : '';
  if (!UUID.test(prospectId)) return reply(400, { error: 'Solicitud no válida.' });

  // ponytail: shows the customer's latest Chatwoot conversation only; list older ones if agents need them.
  const { data: chat, error: chatError } = await db
    .from('whatsapp_chats')
    .select('chatwoot_conversation_id, ambiguous_match')
    .eq('prospect_id', prospectId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (chatError) return reply(401, { error: 'Sesión no válida.' });
  // Same answer for "does not exist" and "not yours". The conversation id comes from PLW only.
  if (!chat) return reply(404, { error: 'Este cliente no tiene chat de WhatsApp.' });

  // The caller's own Chatwoot user, so the reply carries their own name.
  const { data: mine, error: mineError } = await accounts()
    .select('chatwoot_name, token_ciphertext')
    .eq('staff_id', staff.staffId)
    .maybeSingle();
  if (mineError) throw mineError;
  if (!mine) {
    return body.action === 'load' ? reply(200, { connected: false }) : reply(409, { error: NOT_CONNECTED });
  }
  const token = await decryptSecret(mine.token_ciphertext, tokenKey);
  // A token reset or revoked in Chatwoot: forget it, so the agent is asked to connect again.
  const expired = async () => {
    const { error } = await accounts().delete().eq('staff_id', staff.staffId);
    if (error) throw error;
    return body.action === 'load' ? reply(200, { connected: false }) : reply(409, { error: EXPIRED });
  };

  const conversationPath = `/api/v1/accounts/${account}/conversations/${chat.chatwoot_conversation_id}`;
  const templatesPath = `/api/v1/accounts/${account}/inboxes/${inbox}/message_templates`;

  const post = async (message) => {
    const sent = await chatwoot(`${conversationPath}/messages`, token, {
      method: 'POST',
      body: message instanceof FormData ? message : JSON.stringify(message),
    });
    if (sent?.status === 401) return expired();
    if (!sent?.ok) {
      console.error('whatsapp send', sent?.status ?? 'network');
      return reply(502, { error: 'No se pudo enviar el mensaje. Intente de nuevo.' });
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

  switch (body.action) {
    case 'load': {
      // ponytail: Chatwoot returns the latest 20 messages; page with ?before= if agents need more history.
      const [conversation, messages] = await Promise.all([
        chatwoot(conversationPath, token),
        chatwoot(`${conversationPath}/messages`, token),
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
      return templates ? reply(200, { templates }) : TEMPLATES_FAILED;
    }
    case 'send_template': {
      const { name, language, values } = body.template ?? {};
      if (typeof name !== 'string' || typeof language !== 'string') {
        return reply(400, { error: 'Solicitud no válida.' });
      }
      // The template's text and category come from Chatwoot, never from the browser.
      const templates = await loadTemplates(name);
      if (templates === 'expired') return expired();
      if (!templates) return TEMPLATES_FAILED;
      const template = templates.find((item) => item.name === name && item.language === language);
      if (!template) return reply(400, { error: 'Esa plantilla ya no está disponible en Chatwoot.' });
      const message = renderTemplate(template, values);
      if (!message) return reply(400, { error: 'Completa todos los datos de la plantilla.' });
      return post(message);
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
        return post(form);
      }
      if (!text || text.length > MAX_TEXT) {
        return reply(400, { error: `Escribe un mensaje de hasta ${MAX_TEXT} caracteres.` });
      }
      return post({ content: text, message_type: 'outgoing', private: false });
    }
    default:
      return reply(400, { error: 'Acción no válida.' });
  }
}
