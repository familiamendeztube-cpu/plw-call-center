// Tourism campaign ElevenLabs agent config. Mirrors the verified dental agent shape
// (same built-in tool structure and verifier rules) with the tourism prompt and a
// distinct transfer SIP header, so dental alerts and dental stats never fire.
import {
  TOURISM_FIRST_MESSAGE,
  TOURISM_VOICE_MODEL,
  TOURISM_SCRIPT_VERSION,
  tourismPrompt,
} from './tourismScript.js';

const TIMEZONE = 'America/Costa_Rica';

const ELEVENLABS_ROOT = 'https://api.elevenlabs.io/v1/convai';

export async function providerRequest(
  apiKey,
  path,
  body,
  fetchImpl = fetch,
  method = body ? 'POST' : 'GET',
  timeoutMs = 18000
) {
  const response = await fetchImpl(ELEVENLABS_ROOT + path, {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

export function sanitizeProviderError(data) {
  const detail = data?.detail;
  if (typeof detail === 'string') return [{ field: '', type: '', message: detail.slice(0, 160) }];
  if (detail && typeof detail === 'object' && !Array.isArray(detail))
    return [
      {
        field: '',
        type: String(detail.status ?? '').slice(0, 80),
        message: String(detail.message ?? JSON.stringify(detail)).slice(0, 300),
      },
    ];
  if (!detail && typeof data?.message === 'string')
    return [{ field: '', type: '', message: data.message.slice(0, 300) }];
  if (!Array.isArray(detail)) return [];
  return detail.slice(0, 8).map((item) => ({
    field: (Array.isArray(item?.loc) ? item.loc : [])
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .slice(0, 6)
      .map(String)
      .join('.')
      .slice(0, 160),
    type: String(item?.type ?? '').slice(0, 80),
    message: String(item?.msg ?? '').slice(0, 160),
  }));
}

/** Short, safe explanation of a provider answer, stored with the call so failures can be read. */
export function providerReason(result, timeoutSeconds) {
  if (!result?.status) return ` (sin respuesta del proveedor en ${timeoutSeconds} s)`;
  const message =
    typeof result.data?.message === 'string'
      ? result.data.message
      : sanitizeProviderError(result.data)
          .map((item) => [item.field, item.message].filter(Boolean).join(': '))
          .join('; ');
  const text = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  return ` (HTTP ${result.status}${text ? `: ${text}` : ''})`;
}

// Distinct header name: the dental incoming alert filters on X-PLW-Dental-Call, so a
// tourism transfer must never match it.
const TRANSFER_HEADER = { type: 'dynamic', key: 'X-PLW-Tourism-Call', value: 'plw_tourism_call_id' };

const LANGUAGE_TOOL = {
  type: 'system',
  name: 'language_detection',
  description:
    'Cambia el idioma de la llamada solo cuando la persona hable inglés, francés o chino, o pida cambiar de idioma, y vuelve al español cuando hable español o lo pida. Nunca cambies por una sola palabra.',
  params: { system_tool_type: 'language_detection' },
};

const BASIC_TURN = { turn_eagerness: 'patient' };
const IGNORED_REPLIES = [
  'sí', 'si', 'ajá', 'aja', 'mhm', 'ujum', 'ok', 'okey', 'ya', 'bueno', 'claro', 'listo',
  'perfecto', 'gracias', 'muchas gracias', 'pura vida',
];
const TURN = { ...BASIC_TURN, turn_timeout: 10, interruption_ignore_terms: IGNORED_REPLIES };

const isTrue = (value) => value === true || String(value).trim().toLowerCase() === 'true';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const detail = (description) => ({
  type: 'string',
  description: `${description} Write it in Spanish. Leave empty if it was not said in the call; never guess.`,
});
const DETAIL_FIELDS = {
  plw_contact_name: detail('Name of the person Anna spoke with.'),
  plw_contact_role: detail('Their role, e.g. encargado, dueño, administrador.'),
  plw_contact_email: {
    type: 'string',
    description: 'Email the person asked PLW to send information to, spelled letter by letter, lowercase, with @ and dots. Empty if not given or unsure; never guess.',
  },
  plw_whatsapp_number: {
    type: 'string',
    description: 'WhatsApp number the person asked PLW to write to, digits only. Empty if not given.',
  },
  plw_callback_phone: detail('Phone number the person asked PLW to call back, digits only.'),
  plw_decision_maker: detail('Name of the person who decides about bookings or administration, when said.'),
  plw_business_address: detail('Business address given for a visit or proposal.'),
  plw_interest: detail('What the person showed interest in, one short sentence.'),
  plw_objections: detail('Objections raised, short list.'),
  plw_notes: detail('Other important notes for the PLW specialist, briefly.'),
  plw_callback_date: {
    type: 'string',
    description: 'Callback day as YYYY-MM-DD, only if the person confirmed that exact day in this call. Empty if only suggested or unknown.',
  },
  plw_callback_clock: {
    type: 'string',
    description: 'Callback time as HH:MM (24 hours, Costa Rica time), only if confirmed in this call. Empty if only suggested or unknown.',
  },
  plw_callback_confirmed: {
    type: 'string',
    description: "'true' only if both day and time were confirmed by the person; 'false' otherwise.",
  },
};
const OUTCOME_FIELD = {
  plw_outcome: {
    type: 'string',
    description:
      'Exactly one code for how the call ended: APPOINTMENT_CONFIRMED, INTERESTED_FOLLOW_UP, ' +
      'WHATSAPP_INFO_REQUESTED, EMAIL_INFO_REQUESTED, CALLBACK_REQUESTED, RECEPTIONIST_CONTACT, ' +
      'DECISION_MAKER_UNAVAILABLE, NOT_INTERESTED, DO_NOT_CALL, WRONG_NUMBER, NO_ANSWER, ' +
      'VOICEMAIL, TECHNICAL_FAILURE. Use DO_NOT_CALL whenever the person asked not to be called again.',
  },
};
// Every code the plw_outcome field offers. The interested ones become customers through
// tourism_call_to_customer (SQL); the rest stay on the call row for the admin list.
export const TOURISM_OUTCOMES = [
  'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'WHATSAPP_INFO_REQUESTED', 'EMAIL_INFO_REQUESTED',
  'CALLBACK_REQUESTED', 'RECEPTIONIST_CONTACT', 'DECISION_MAKER_UNAVAILABLE', 'NOT_INTERESTED',
  'DO_NOT_CALL', 'WRONG_NUMBER', 'NO_ANSWER', 'VOICEMAIL', 'TECHNICAL_FAILURE',
];

export function tourismAgentConfig(staffName, route, voiceId, { basicTurn = false } = {}) {
  return {
    name: `PLW Turismo · Anna · ${staffName} · ${TOURISM_SCRIPT_VERSION}`,
    tags: ['plw-tourism'],
    conversation_config: {
      agent: {
        language: 'es',
        first_message: TOURISM_FIRST_MESSAGE,
        prompt: {
          prompt:
            tourismPrompt() +
            `\nVersión: ${TOURISM_SCRIPT_VERSION}.\n\nTRANSFERENCIA\nTransferir no es el objetivo de la llamada: primero está el flujo del guion y solo si la persona quiere hablar ahora mismo con ${staffName}, usa transfer_to_number hacia ${route.transfer_uri}. Si prefiere otro momento, coordina la llamada de seguimiento: acepta el día y la hora que la persona dé, confírmalos en voz alta y cierra. Nunca transfieras sin aceptación ni digas que la comunicaste si la herramienta no lo confirmó.\n\nBUZÓN DE VOZ\nSolo si escuchas un buzón de voz o una contestadora que pide dejar mensaje, usa voicemail_detection de inmediato sin dejar mensaje. Un menú de opciones NO es buzón: espera a que una persona atienda.`,
          tool_ids: [],
          mcp_server_ids: [],
          knowledge_base: [],
          timezone: TIMEZONE,
          built_in_tools: {
            end_call: { type: 'system', name: 'end_call', params: { system_tool_type: 'end_call' } },
            voicemail_detection: {
              type: 'system',
              name: 'voicemail_detection',
              params: { system_tool_type: 'voicemail_detection' },
            },
            language_detection: LANGUAGE_TOOL,
            transfer_to_number: {
              type: 'system',
              name: 'transfer_to_number',
              params: {
                system_tool_type: 'transfer_to_number',
                transfers: [
                  {
                    transfer_destination: { type: 'sip_uri', sip_uri: route.transfer_uri },
                    transfer_type: 'sip_refer',
                    condition: `La persona expresa interés y acepta hablar ahora mismo con ${staffName}.`,
                    custom_sip_headers: [TRANSFER_HEADER],
                  },
                ],
              },
            },
          },
        },
      },
      language_presets: {
        en: { overrides: { agent: {} } },
        fr: { overrides: { agent: {} } },
        zh: { overrides: { agent: {} } },
      },
      tts: { voice_id: voiceId, model_id: TOURISM_VOICE_MODEL },
      vad: { background_voice_detection: true },
      turn: basicTurn ? BASIC_TURN : TURN,
      conversation: { max_duration_seconds: 600 },
    },
    platform_settings: {
      data_collection: {
        ...OUTCOME_FIELD,
        ...DETAIL_FIELDS,
        plw_opt_out: {
          type: 'boolean',
          description:
            'True only if the person requests no more calls or removal from the calling list, in any language.',
        },
      },
    },
  };
}

/** Mirrors dental provider.callResults for the tourism field set. */
export function tourismCallResults(analysis) {
  const values = new Map();
  const map = analysis?.data_collection_results;
  const entries = [
    ...(map && typeof map === 'object' && !Array.isArray(map) ? Object.entries(map) : []),
    ...[map, analysis?.data_collection_results_list].flatMap((list) =>
      Array.isArray(list) ? list.map((entry) => [entry?.data_collection_id, entry]) : []
    ),
  ];
  for (const [id, entry] of entries)
    if (typeof id === 'string' && entry && typeof entry === 'object' && !values.has(id))
      values.set(id, entry.value ?? null);
  const outcomeText = String(values.get('plw_outcome') ?? '').trim().toUpperCase();
  const outcome = TOURISM_OUTCOMES.includes(outcomeText) ? outcomeText : null;
  const details = {};
  for (const id of Object.keys(DETAIL_FIELDS)) {
    const value = values.get(id);
    const clean = typeof value === 'string' || typeof value === 'number'
      ? String(value).replace(/\s+/g, ' ').trim().slice(0, 300)
      : '';
    if (clean && !/^(null|none|n\/a)$/i.test(clean)) details[id.slice(4)] = clean;
  }
  if (details.contact_email && !EMAIL_PATTERN.test(details.contact_email)) delete details.contact_email;
  const optOut = isTrue(values.get('plw_opt_out')) || outcome === 'DO_NOT_CALL';
  return { outcome, details, optOut };
}

const text = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

/** Same verifier rules as the dental agent: any drift pauses the dialer. */
export function tourismConfigFailures(config, route) {
  if (!config || typeof config !== 'object') return ['provider_read'];
  if (config.agent_id !== route.provider_agent_id) return ['agent_identity'];
  const failures = [];
  const agent = config.conversation_config?.agent;
  const p = agent?.prompt;
  if (text(agent?.first_message) !== text(TOURISM_FIRST_MESSAGE)) failures.push('first_message');
  if (agent?.language !== 'es') failures.push('language');
  if (p?.timezone !== TIMEZONE) failures.push('timezone');
  if (config.conversation_config?.tts?.model_id !== TOURISM_VOICE_MODEL) failures.push('voice_model');
  if (
    config.conversation_config?.vad?.background_voice_detection !== true ||
    config.conversation_config?.turn?.turn_eagerness !== 'patient'
  )
    failures.push('noise_settings');
  if (!text(p?.prompt).startsWith(text(tourismPrompt()))) failures.push('prompt_base');
  if (!text(p?.prompt).includes(TOURISM_SCRIPT_VERSION)) failures.push('script_version');
  const collected = config.platform_settings?.data_collection ?? {};
  if (!Object.keys(DETAIL_FIELDS).every((field) => field in collected)) failures.push('extraction_fields');
  if (p?.tool_ids?.length || p?.mcp_server_ids?.length || p?.knowledge_base?.length) failures.push('extra_tools_or_knowledge');
  if (!text(p?.prompt).includes('TURISMO')) failures.push('prompt_tourism');
  const built = p?.built_in_tools ?? {};
  if (
    Object.entries(built).some(
      ([name, value]) =>
        value && !['end_call', 'transfer_to_number', 'voicemail_detection', 'language_detection'].includes(name)
    )
  )
    failures.push('extra_builtin_tool');
  if (!built.voicemail_detection) failures.push('voicemail_detection');
  if (!built.language_detection) failures.push('language_detection');
  const presets = config.conversation_config?.language_presets ?? {};
  if (
    !['en', 'fr', 'zh'].every((lang) => presets[lang]) ||
    Object.values(presets).some((preset) => text(preset?.overrides?.agent?.first_message) !== '')
  )
    failures.push('language_presets');
  const t = built.transfer_to_number?.params?.transfers;
  if (!Array.isArray(t) || t.length !== 1) failures.push('transfer_count');
  else {
    if (t[0].transfer_type !== 'sip_refer') failures.push('transfer_type');
    if (t[0].transfer_destination?.sip_uri !== route.transfer_uri) failures.push('transfer_destination');
    const h = t[0].custom_sip_headers;
    if (
      !Array.isArray(h) ||
      h.length !== 1 ||
      h[0]?.key !== TRANSFER_HEADER.key ||
      h[0]?.value !== TRANSFER_HEADER.value
    )
      failures.push('transfer_headers');
  }
  return failures;
}
