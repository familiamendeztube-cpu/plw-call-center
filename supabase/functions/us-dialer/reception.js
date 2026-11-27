// PLW USA — Recepción: the AI that answers the Hollywood number (+1 754-799-1065) when no agent
// picks up. The phone server sends it the call after the agents' queue, like the Costa Rica
// receptionist, and it takes a callback. Built from the Costa Rica receptionist (voice, speech
// settings, post-call webhook), with its own bilingual script and the 9 fields PLW's post-call
// webhook reads (supabase/functions/elevenlabs-webhook/rules.js FIELD_IDS).
import { providerRequest } from './provider.js';
import { US_LLM, US_VOICE_EN, US_VOICE_ES, US_VOICE_MODEL } from './usScript.js';

/** The Costa Rica receptionist: PLW_AGENT_ID in elevenlabs-webhook/rules.js. */
export const CR_RECEPTION_AGENT_ID = 'agent_8601m6hbjwamevz887627c1qp0sq';
export const RECEPTION_SETTINGS_KEY = 'us_reception_agent';
export const RECEPTION_VERSION = 'recepcion-us-2026-11-27';
export const RECEPTION_NAME = 'PLW USA — Recepción';
export const RECEPTION_TIMEZONE = 'America/Los_Angeles';

// Owner's entry line (2026-11-27): why they call comes first; language still switches live.
export const RECEPTION_FIRST_MESSAGE =
  'Gracias por llamar a Professional Latino Workers. Soy Anna. ¿En qué le puedo ayudar?';

const field = (description, type = 'string') => ({ type, description });

export const RECEPTION_FIELDS = {
  customer_name: field('Name of the caller. Empty if they did not say it; never guess.'),
  business_name: field("Name of the caller's business. Empty if they did not say it."),
  business_type: field('Type of business (restaurant, clinic, shop...). Empty if they did not say it.'),
  call_reason: field('Why they called, one or two sentences, in the language they used.'),
  preferred_contact: field("How they want PLW to reach them: 'phone', 'whatsapp' or 'email'. Empty if not said."),
  callback_time: field(
    "When they want the callback, as they said it, with their city or time zone if given (for example 'Tuesday 3 pm, Miami'). Empty if they did not say."
  ),
  callback_phone: field(
    'Phone number for the callback, digits with the country code (+1 and 10 digits for the US). The number they are calling from if they confirmed it. Empty if unknown.'
  ),
  callback_consent: field('true only if the caller agreed that PLW calls them back; false if they refused.', 'boolean'),
  call_summary: field('Resumen breve en español de la llamada para el agente de PLW: quién llamó, qué necesita y cuándo llamarle.'),
};

export function receptionPrompt() {
  return `Eres Anna, asistente virtual de Professional Latino Workers (PLW), hecha con inteligencia artificial. Contestas el número de PLW en Estados Unidos cuando ningún agente pudo atender la llamada.

QUIÉN ES USTED (reglas duras):
- Nunca se haga pasar por humana. Si le preguntan si es una persona o una IA, responda de inmediato y con honestidad: es una asistente de inteligencia artificial de PLW.
- Identifíquese como de PLW y respete los avisos de IA que exija la configuración o las normas del destino.

IDioma: después del saludo, el español es el idioma por defecto. Si la persona usa inglés o pide inglés, siga en inglés de forma natural, sin reiniciar la llamada ni repetir el saludo. Nunca suponga el idioma por el apellido o el acento.

LLAMADA:
1. Su prioridad es POR QUÉ llama: escuche el motivo antes de pedir nada. Si es una solicitud de servicio o información de PLW, atienda eso; solo si es soporte técnico de un cliente actual, tome los datos y quede en devolución.
2. En una frase: con gusto toma sus datos para que un especialista de PLW le devuelva la llamada.
3. Pregunta una cosa a la vez: su nombre, el nombre y el tipo de su negocio, y lo que necesite del motivo de la llamada.
4. Número para devolver la llamada: ofrece el número desde el que llama y repítelo dígito por dígito para confirmarlo. Si prefiere otro, anótalo con código de área y repítelo.
5. Pregunta cuándo prefiere que lo llamen y en qué ciudad o zona horaria está. PLW devuelve llamadas de lunes a viernes. No prometas una hora exacta: di que un especialista le llamará lo antes posible en ese horario.
6. Pregunta si autoriza que PLW le devuelva la llamada y si prefiere llamada, WhatsApp o correo.
7. Resume lo que anotaste, agradece y despídete. Luego termina la llamada.

SOBRE PLW (solo si preguntan): recepción virtual multilingüe para negocios que contesta llamadas y WhatsApp en español, inglés y mandarín cuando el equipo está ocupado o ya cerró, y el diseño de una página web incluido gratis con el servicio. Oficinas en 6725 Sunset Blvd, Los Angeles, CA 90028. Si preguntan el precio, dilo exacto: 200 dólares al mes, precio fijo, diseño del sitio incluido gratis y cancelación cuando quiera; no inventes descuentos, promociones ni garantías.

MUESTRA MULTILINGÜE (solo si hablan de lo que hace la recepción): en español "Gracias por llamar, ¿en qué le puedo ayudar?", en inglés "Thanks for calling. How can I help you?", en mandarín "您好，请问有什么可以帮您？". No prometas "todos los idiomas".

LÍMITES:
- Si la persona pide que no la llamen, respétalo: agradece y termina sin tomar la devolución.
- Si es una grabación, un buzón o nadie habla, termina la llamada.
- Sé breve y amable; la llamada no debe pasar de cinco minutos. Nunca transfieras la llamada ni conectes a nadie en vivo: la devolución de PLW es el único cierre.`;
}

const pick = (source, keys) =>
  Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));

/**
 * The receptionist's ElevenLabs config. From the Costa Rica receptionist it keeps what is proven
 * on calls (speech settings, speech recognition, turn taking, background noise, call limits) and
 * its post-call webhook override when it has one. Voices, voice model and LLM are Anna's US ones.
 */
export function usReceptionConfig(crAgent) {
  const cr = crAgent?.conversation_config ?? {};
  const crPrompt = cr.agent?.prompt ?? {};
  const webhooks = crAgent?.platform_settings?.workspace_overrides?.webhooks;
  return {
    name: RECEPTION_NAME,
    tags: ['plw-us', 'recepcion'],
    conversation_config: {
      ...pick(cr, ['asr', 'turn', 'vad', 'conversation']),
      tts: { ...cr.tts, voice_id: US_VOICE_ES, model_id: US_VOICE_MODEL },
      agent: {
        language: 'es',
        first_message: RECEPTION_FIRST_MESSAGE,
        prompt: {
          ...pick(crPrompt, ['temperature', 'max_tokens']),
          llm: US_LLM,
          prompt: `${receptionPrompt()}\nVersión: ${RECEPTION_VERSION}.`,
          timezone: RECEPTION_TIMEZONE,
          tool_ids: [],
          knowledge_base: [],
          built_in_tools: {
            end_call: { type: 'system', name: 'end_call', params: { system_tool_type: 'end_call' } },
            language_detection: {
              type: 'system',
              name: 'language_detection',
              description:
                'Cambia el idioma cuando la persona hable otro idioma o pida cambiar. Nunca por una sola palabra.',
              params: { system_tool_type: 'language_detection' },
            },
          },
        },
      },
      language_presets: { en: { overrides: { agent: {}, tts: { voice_id: US_VOICE_EN } } } },
    },
    platform_settings: {
      data_collection: RECEPTION_FIELDS,
      ...(webhooks ? { workspace_overrides: { webhooks } } : {}),
    },
  };
}

/**
 * Creates the receptionist, or updates it in place, and keeps its id in settings
 * (us_reception_agent). It never touches a phone number: assigning it to the Hollywood number
 * is a separate, deliberate step in ElevenLabs.
 */
export async function ensureUsReception(db, apiKey, fetchImpl = fetch) {
  const cr = await providerRequest(apiKey, `/agents/${CR_RECEPTION_AGENT_ID}`, undefined, fetchImpl);
  if (!cr.ok || !cr.data) return { ok: false, error: `No se pudo leer la recepción de Costa Rica (HTTP ${cr.status}).` };
  const config = usReceptionConfig(cr.data);

  const { data: row } = await db.from('settings').select('value').eq('key', RECEPTION_SETTINGS_KEY).maybeSingle();
  let agentId = typeof row?.value?.agent_id === 'string' ? row.value.agent_id : null;
  let result = agentId
    ? await providerRequest(apiKey, `/agents/${encodeURIComponent(agentId)}`, config, fetchImpl, 'PATCH')
    : null;
  if (!result || result.status === 404) {
    result = await providerRequest(apiKey, '/agents/create', config, fetchImpl);
    agentId = typeof result.data?.agent_id === 'string' ? result.data.agent_id : null;
  }
  if (!result.ok || !agentId)
    return { ok: false, error: `ElevenLabs no confirmó la recepción (HTTP ${result.status}).`, detail: result.data };

  const { error } = await db.from('settings').upsert(
    {
      key: RECEPTION_SETTINGS_KEY,
      value: { agent_id: agentId, version: RECEPTION_VERSION },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) throw error;
  return {
    ok: true,
    agent_id: agentId,
    name: RECEPTION_NAME,
    webhook: config.platform_settings.workspace_overrides ? 'copied from Costa Rica' : 'workspace default',
    voice_id: config.conversation_config.tts?.voice_id ?? null,
    model_id: config.conversation_config.tts?.model_id ?? null,
  };
}

/**
 * Which ElevenLabs agent the US number sends calls to. The phone server hands it the calls no
 * agent picked up, so this is the agent US callers hear. Read-only.
 */
export async function usNumberAgent(db, apiKey, fetchImpl = fetch) {
  const { data: runtime } = await db.from('us_dialer_runtime').select('phone_number_id').eq('id', 1).maybeSingle();
  const id = runtime?.phone_number_id;
  if (!id) return { ok: false, error: 'El marcador de EE. UU. no tiene número configurado.' };
  const number = await providerRequest(apiKey, `/phone-numbers/${encodeURIComponent(id)}`, undefined, fetchImpl);
  if (!number.ok) return { ok: false, error: `ElevenLabs no devolvió el número (HTTP ${number.status}).` };
  const { data: row } = await db.from('settings').select('value').eq('key', RECEPTION_SETTINGS_KEY).maybeSingle();
  const receptionId = typeof row?.value?.agent_id === 'string' ? row.value.agent_id : null;
  const assigned = number.data?.assigned_agent;
  return {
    ok: true,
    phone_number_id: id,
    phone_number: number.data?.phone_number ?? null,
    label: number.data?.label ?? null,
    assigned_agent: assigned ? { agent_id: assigned.agent_id ?? null, agent_name: assigned.agent_name ?? null } : null,
    reception_agent_id: receptionId,
    is_reception: Boolean(receptionId) && assigned?.agent_id === receptionId,
  };
}

/** Puts PLW USA — Recepción on the US number and reads it back. Only the agent changes. */
export async function assignUsReception(db, apiKey, fetchImpl = fetch) {
  const before = await usNumberAgent(db, apiKey, fetchImpl);
  if (!before.ok) return before;
  if (!before.reception_agent_id) return { ...before, ok: false, error: 'Falta crear PLW USA — Recepción.' };
  if (before.is_reception) return { ...before, changed: false };
  const patched = await providerRequest(
    apiKey,
    `/phone-numbers/${encodeURIComponent(before.phone_number_id)}`,
    { agent_id: before.reception_agent_id },
    fetchImpl,
    'PATCH'
  );
  if (!patched.ok)
    return { ok: false, error: `ElevenLabs no aceptó el cambio (HTTP ${patched.status}).`, previous: before.assigned_agent };
  return { ...(await usNumberAgent(db, apiKey, fetchImpl)), changed: true, previous: before.assigned_agent };
}
