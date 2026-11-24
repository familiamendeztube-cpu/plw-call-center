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

/** Tolerant CR phone normalization: optional 506 country code, optional leading zeros typed
 *  by hand, then exactly 8 valid digits — "(506) 7004-0079", "0 7004 0079" and
 *  "50670040079" all resolve; anything longer or malformed is null. */
export function normalizeTourismPhone(input) {
  const local = String(input ?? '').replace(/\D/g, '').replace(/^506/, '').replace(/^0+/, '');
  return /^[2-8]\d{7}$/.test(local) ? local : null;
}

/** True when a stored call error is the provider refusing the dial with SIP 403. */
export function isSip403Error(message) {
  return typeof message === 'string' && /SIP 403|403 Forbidden/i.test(message);
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

// skip_turn is how Anna stays quiet: without it, every hold, menu or pause in a dictated email
// made her say something ("sigo esperando" on 2026-11-20, which voice menus rejected).
const SKIP_TURN_TOOL = {
  type: 'system',
  name: 'skip_turn',
  description:
    'Quédate en silencio sin decir nada: cuando la persona pide un momento o te pone en espera, durante música de espera, grabaciones o menús automáticos, y mientras te dicta un correo o un número que aún no termina.',
  params: { system_tool_type: 'skip_turn' },
};
const KEYPAD_TOOL = {
  type: 'system',
  name: 'play_keypad_touch_tone',
  description:
    'Marca una opción de un menú automático: reservaciones o ventas; si el menú no la tiene, operadora, recepción o administración.',
  params: { system_tool_type: 'play_keypad_touch_tone' },
};
const BUILT_IN_TOOLS = ['end_call', 'transfer_to_number', 'voicemail_detection', 'language_detection', 'skip_turn', 'play_keypad_touch_tone'];

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
    description:
      'Email the person asked PLW to send information to, lowercase, with @ and dots, no spaces or accents. ' +
      'Use the LAST version: the one Anna read back and the person confirmed, or their correction after it, ' +
      'never the first one heard. If nobody confirmed it, leave this empty and write "correo sin confirmar: ..." ' +
      'with what was heard in plw_notes. Never guess.',
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
  plw_demo_coverage_gap: {
    type: 'string',
    description:
      "'true' only if the person said or implied nobody covers English guest messages after hours " +
      "(e.g. nadie, hasta mañana, se nos complica); 'false' if they said it is covered; empty if the " +
      'question was not asked or the answer was unclear. Never guess.',
  },
  plw_demo_date: {
    type: 'string',
    description:
      'Agreed demo day as YYYY-MM-DD, only if the person CONFIRMED that exact day for the demo in this call. ' +
      'Empty if only suggested, declined or unknown; never guess.',
  },
  plw_demo_clock: {
    type: 'string',
    description:
      'Agreed demo time as HH:MM (24 hours, Costa Rica time), only if the person CONFIRMED that exact time ' +
      'for the demo in this call. Empty if only suggested, declined or unknown; never guess.',
  },
  plw_demo_confirmed: {
    type: 'string',
    description: "'true' only if both demo day and time were confirmed by the person; 'false' otherwise.",
  },
};
const OUTCOME_FIELD = {
  plw_outcome: {
    type: 'string',
    description:
      'Exactly one code for how the call ended: APPOINTMENT_CONFIRMED, INTERESTED_FOLLOW_UP, ' +
      'WHATSAPP_INFO_REQUESTED, EMAIL_INFO_REQUESTED, CALLBACK_REQUESTED, DEMO_SCHEDULED, ' +
      'RECEPTIONIST_CONTACT, DECISION_MAKER_UNAVAILABLE, NOT_INTERESTED, DO_NOT_CALL, WRONG_NUMBER, ' +
      'NO_ANSWER, VOICEMAIL, TECHNICAL_FAILURE. Use DEMO_SCHEDULED only when the person confirmed both ' +
      'day and time for the demo. Use DO_NOT_CALL whenever the person asked not to be called again. ' +
      'NOT_INTERESTED only when a person said no; a recording is never NOT_INTERESTED. ' +
      'WRONG_NUMBER only when a person said it is not that business, or a recording said the number changed ' +
      '(put the new number in plw_notes); a phone menu is never WRONG_NUMBER. ' +
      'TECHNICAL_FAILURE only for a broken line or no audio; if the person put Anna on hold and nobody came ' +
      'back, use RECEPTIONIST_CONTACT or DECISION_MAKER_UNAVAILABLE.',
  },
};
// Every code the plw_outcome field offers. The interested ones become customers through
// tourism_call_to_customer (SQL); the rest stay on the call row for the admin list.
export const TOURISM_OUTCOMES = [
  'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'WHATSAPP_INFO_REQUESTED', 'EMAIL_INFO_REQUESTED',
  'CALLBACK_REQUESTED', 'DEMO_SCHEDULED', 'RECEPTIONIST_CONTACT', 'DECISION_MAKER_UNAVAILABLE',
  'NOT_INTERESTED', 'DO_NOT_CALL', 'WRONG_NUMBER', 'NO_ANSWER', 'VOICEMAIL', 'TECHNICAL_FAILURE',
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
          // Transfer and voicemail rules live once, in the script; a second copy here disagreed
          // with it about menus.
          prompt: tourismPrompt() + `\nVersión: ${TOURISM_SCRIPT_VERSION}.`,
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
            skip_turn: SKIP_TURN_TOOL,
            play_keypad_touch_tone: KEYPAD_TOOL,
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
      // Expressive mode lets the LLM write delivery tags; on 2026-11-20 it wrote [slow] into
      // ordinary replies and Anna dragged. v3 has no speed setting to correct it.
      tts: { voice_id: voiceId, model_id: TOURISM_VOICE_MODEL, expressive_mode: false },
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
  if (config.conversation_config?.tts?.expressive_mode !== false) failures.push('expressive_mode');
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
  if (Object.entries(built).some(([name, value]) => value && !BUILT_IN_TOOLS.includes(name)))
    failures.push('extra_builtin_tool');
  if (!built.voicemail_detection) failures.push('voicemail_detection');
  if (!built.language_detection) failures.push('language_detection');
  if (!built.skip_turn) failures.push('skip_turn');
  if (!built.play_keypad_touch_tone) failures.push('keypad');
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
