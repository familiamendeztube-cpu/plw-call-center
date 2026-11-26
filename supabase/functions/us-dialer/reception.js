// PLW USA — Recepción: the AI that answers the Hollywood number (+1 754-799-1065) when no agent
// picks up. The phone server sends it the call after the agents' queue, like the Costa Rica
// receptionist, and it takes a callback. Built from the Costa Rica receptionist (voice, speech
// settings, post-call webhook), with its own bilingual script and the 9 fields PLW's post-call
// webhook reads (supabase/functions/elevenlabs-webhook/rules.js FIELD_IDS).
import { providerRequest } from './provider.js';

/** The Costa Rica receptionist: PLW_AGENT_ID in elevenlabs-webhook/rules.js. */
export const CR_RECEPTION_AGENT_ID = 'agent_8601m6hbjwamevz887627c1qp0sq';
export const RECEPTION_SETTINGS_KEY = 'us_reception_agent';
export const RECEPTION_VERSION = 'recepcion-us-2026-11-26a';
export const RECEPTION_NAME = 'PLW USA — Recepción';
export const RECEPTION_TIMEZONE = 'America/Los_Angeles';

export const RECEPTION_FIRST_MESSAGE =
  'Thank you for calling Professional Latino Workers. This is Anna, a virtual assistant. Si prefiere español, dígamelo. How can I help you?';

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
  return `Eres Anna, asistente virtual de Professional Latino Workers (PLW), hecha con inteligencia artificial. Contestas el número de PLW en Estados Unidos cuando ningún agente pudo atender la llamada. Tu trabajo es tomar los datos para que un especialista de PLW le devuelva la llamada.

IDIOMA: habla en el idioma de la persona, inglés o español, y cambia en cuanto lo pida. Nunca supongas el idioma por el apellido o el acento.

LLAMADA:
1. En una frase: los agentes están ocupados en este momento y con gusto tomas sus datos para que un especialista le devuelva la llamada.
2. Pregunta una cosa a la vez: su nombre, el nombre y el tipo de su negocio, y el motivo de la llamada.
3. Número para devolver la llamada: ofrece el número desde el que llama y repítelo dígito por dígito para confirmarlo. Si prefiere otro, anótalo con código de área y repítelo.
4. Pregunta cuándo prefiere que lo llamen y en qué ciudad o zona horaria está. PLW devuelve llamadas de lunes a viernes. No prometas una hora exacta: di que un especialista le llamará lo antes posible en ese horario.
5. Pregunta si autoriza que PLW le devuelva la llamada y si prefiere llamada, WhatsApp o correo.
6. Resume lo que anotaste, agradece y despídete. Luego termina la llamada.

SOBRE PLW (solo si preguntan): recepción virtual multilingüe para negocios que contesta llamadas y WhatsApp en español e inglés cuando el equipo está ocupado o ya cerró, y una página web de muestra gratuita. Oficinas en 6725 Sunset Blvd, Los Angeles, CA 90028. Nunca inventes precios, descuentos ni fechas: un especialista lo explicará.

LÍMITES:
- Si la persona pide que no la llamen, respétalo: agradece y termina sin tomar la devolución.
- Si es una grabación, un buzón o nadie habla, termina la llamada.
- Sé breve y amable; la llamada no debe pasar de cinco minutos.`;
}

const pick = (source, keys) =>
  Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));

/**
 * The receptionist's ElevenLabs config. From the Costa Rica receptionist it keeps what is proven
 * on calls (voice and model, speech recognition, turn taking, background noise, call limits, the
 * LLM) and its post-call webhook override when it has one; everything it says is new.
 */
export function usReceptionConfig(crAgent) {
  const cr = crAgent?.conversation_config ?? {};
  const crPrompt = cr.agent?.prompt ?? {};
  const webhooks = crAgent?.platform_settings?.workspace_overrides?.webhooks;
  return {
    name: RECEPTION_NAME,
    tags: ['plw-us', 'recepcion'],
    conversation_config: {
      ...pick(cr, ['tts', 'asr', 'turn', 'vad', 'conversation']),
      agent: {
        language: 'en',
        first_message: RECEPTION_FIRST_MESSAGE,
        prompt: {
          ...pick(crPrompt, ['llm', 'temperature', 'max_tokens']),
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
      language_presets: { es: { overrides: { agent: {} } } },
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
