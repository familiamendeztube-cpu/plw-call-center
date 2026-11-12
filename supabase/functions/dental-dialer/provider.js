import {
  DENTAL_FIRST_MESSAGE,
  salesPrompt,
  SALES_SCRIPT_VERSION,
  SALES_VOICE_MODEL,
} from './salesScript.js';
import { PLW_AGENT_ID } from './rules.js';
const ROOT = 'https://api.elevenlabs.io/v1/convai';
export async function providerRequest(
  apiKey,
  path,
  body,
  fetchImpl = fetch,
  method = body ? 'POST' : 'GET',
  timeoutMs = 18000
) {
  const response = await fetchImpl(ROOT + path, {
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
// For a "dynamic" header ElevenLabs wants the variable's NAME, not a {{template}}: the value
// "{{plw_dental_call_id}}" made every transfer fail with MissingDynamicVariableError.
const TRANSFER_HEADER = { type: 'dynamic', key: 'X-PLW-Dental-Call', value: 'plw_dental_call_id' };
// The owner's 13 call outcomes. ElevenLabs fills these fields from the transcript after the call.
export const CALL_OUTCOMES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REQUESTED',
  'INTERESTED_FOLLOW_UP',
  'WHATSAPP_INFO_REQUESTED',
  'RECEPTIONIST_CONTACT',
  'DECISION_MAKER_UNAVAILABLE',
  'CALLBACK_REQUESTED',
  'NOT_INTERESTED',
  'DO_NOT_CALL',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'VOICEMAIL',
  'TECHNICAL_FAILURE',
];
const OUTCOME_FIELD = {
  plw_outcome: {
    type: 'string',
    description: `Exactly one code for how the call ended: ${CALL_OUTCOMES.join(', ')}. Anna has no calendar, so an agreed visit is APPOINTMENT_REQUESTED; use APPOINTMENT_CONFIRMED only if a confirmed slot exists. Use DO_NOT_CALL whenever the person asked not to be called again.`,
  },
};
const detail = (description) => ({
  type: 'string',
  description: `${description} Write it in Spanish. Leave empty if it was not said in the call; never guess.`,
});
const DETAIL_FIELDS = {
  plw_contact_name: detail('Name of the person Anna spoke with.'),
  plw_contact_role: detail('Their role, e.g. recepcionista, dueña, administrador, gerente.'),
  plw_contact_phone: detail('Phone or WhatsApp number the person authorized PLW to use, digits only.'),
  plw_business_address: detail('Business address given for the visit.'),
  plw_appointment_date: detail('Preferred visit day the person agreed to, as they said it.'),
  plw_appointment_time: detail('Preferred visit time or part of day the person agreed to.'),
  plw_callback_time: detail('Day and time the person asked to be called back.'),
  plw_pain_point: detail('Main administrative problem the person described, in one sentence.'),
  plw_services_interest: detail('Services they showed interest in (llamadas, WhatsApp, formularios, citas, publicidad, página web).'),
  plw_objections: detail('Objections the person raised, as a short list.'),
  plw_notes: detail('Other important notes for the PLW specialist, briefly.'),
};
const OUTCOME_LEAD_STATUS = {
  APPOINTMENT_CONFIRMED: 'interested',
  APPOINTMENT_REQUESTED: 'interested',
  INTERESTED_FOLLOW_UP: 'interested',
  WHATSAPP_INFO_REQUESTED: 'interested',
  RECEPTIONIST_CONTACT: 'callback',
  DECISION_MAKER_UNAVAILABLE: 'callback',
  CALLBACK_REQUESTED: 'callback',
  VOICEMAIL: 'callback', // Owner's rule: the lead's agent calls back.
  NOT_INTERESTED: 'not_interested',
  WRONG_NUMBER: 'wrong_number',
  DO_NOT_CALL: 'do_not_call',
};
// Owner, 2026-11-12: Anna reacted to background noise on clinic lines. ElevenLabs ignores
// voices and noise behind the caller, and Anna waits a little longer before taking her turn.
// Also verified, so "Configurar Ana" pushes them to agents created before this change.
const NOISE_SETTINGS = {
  vad: { background_voice_detection: true },
  turn: { turn_eagerness: 'patient' },
};
const isTrue = (value) => value === true || String(value).trim().toLowerCase() === 'true';
/**
 * Reads ElevenLabs' post-call fields. Results come keyed by field id or as a list, and
 * booleans sometimes arrive as the string "true". VOICEMAIL becomes a callback for the lead's
 * agent; NO_ANSWER and TECHNICAL_FAILURE leave the lead pending so a person can decide.
 */
export function callResults(analysis) {
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
  const outcome = CALL_OUTCOMES.includes(outcomeText) ? outcomeText : null;
  const details = {};
  for (const id of Object.keys(DETAIL_FIELDS)) {
    const value = values.get(id);
    const clean = typeof value === 'string' || typeof value === 'number'
      ? String(value).replace(/\s+/g, ' ').trim().slice(0, 300)
      : '';
    if (clean && !/^(null|none|n\/a)$/i.test(clean)) details[id.slice(4)] = clean;
  }
  const optOut = isTrue(values.get('plw_opt_out')) || outcome === 'DO_NOT_CALL';
  const leadStatus = optOut
    ? 'do_not_call'
    : (OUTCOME_LEAD_STATUS[outcome] ??
      (isTrue(values.get('plw_callback')) ? 'callback' : isTrue(values.get('plw_interested')) ? 'interested' : null));
  return { outcome, details, optOut, leadStatus };
}
export function dentalAgentConfig(staffName, route, voiceId) {
  return {
    name: `PLW Dental · Anna · ${staffName} · ${SALES_SCRIPT_VERSION}`,
    tags: ['plw-dental'],
    conversation_config: {
      agent: {
        language: 'es',
        first_message: DENTAL_FIRST_MESSAGE,
        prompt: {
          prompt:
            salesPrompt({ dentalMode: true }) +
            `\nVersión: ${SALES_SCRIPT_VERSION}.\n\nTRANSFERENCIA\nTu asesor es ${staffName}. Cuando la persona encargada muestre interés real, antes de coordinar una visita pregúntale: "¿Le gustaría que le comunique ahora mismo con ${staffName}, nuestro asesor, para que le explique con más detalle?" Solo si acepta, avísale que la vas a comunicar y usa transfer_to_number hacia ${route.transfer_uri}. Si no acepta, no puede hablar en este momento o la transferencia no se completa, coordina la visita de la sección 6 o una llamada de ${staffName} en el día y la hora que prefiera. Nunca transfieras sin aceptación ni digas que la comunicaste si la herramienta no lo confirmó.\n\nBUZÓN DE VOZ\nSi contesta un buzón de voz, una contestadora o una grabación, no hagas la presentación ni dejes mensaje: usa voicemail_detection de inmediato.`,
          tool_ids: [],
          mcp_server_ids: [],
          knowledge_base: [],
          built_in_tools: {
            end_call: {
              type: 'system',
              name: 'end_call',
              params: { system_tool_type: 'end_call' },
            },
            // Without a voicemail_message ElevenLabs hangs up as soon as it detects voicemail.
            voicemail_detection: {
              type: 'system',
              name: 'voicemail_detection',
              params: { system_tool_type: 'voicemail_detection' },
            },
            transfer_to_number: {
              type: 'system',
              name: 'transfer_to_number',
              params: {
                system_tool_type: 'transfer_to_number',
                transfers: [
                  {
                    transfer_destination: { type: 'sip_uri', sip_uri: route.transfer_uri },
                    transfer_type: 'sip_refer',
                    condition: `La persona expresa interés y acepta hablar ahora con ${staffName}.`,
                    custom_sip_headers: [TRANSFER_HEADER],
                  },
                ],
              },
            },
          },
        },
      },
      tts: { voice_id: voiceId, model_id: SALES_VOICE_MODEL },
      ...NOISE_SETTINGS,
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
        plw_interested: {
          type: 'boolean',
          description:
            'True only if the person explicitly expresses interest in the PLW dental reception service. Do not infer interest from politeness.',
        },
        plw_callback: {
          type: 'boolean',
          description: 'True only if the person requests a call back at another time.',
        },
      },
    },
  };
}
export function sanitizeProviderError(data) {
  const detail = data?.detail;
  if (typeof detail === 'string') return [{ field: '', type: '', message: detail.slice(0, 160) }];
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
export function agentShape(config) {
  const p = config?.conversation_config?.agent?.prompt ?? {};
  const nodes = Object.values(config?.workflow?.nodes ?? {});
  return {
    tool_ids: (p.tool_ids ?? []).length,
    mcp_server_ids: (p.mcp_server_ids ?? []).length,
    knowledge_base: (p.knowledge_base ?? []).length,
    legacy_tools: (p.tools ?? []).map((tool) => ({
      name: String(tool?.name ?? '').slice(0, 80),
      type: String(tool?.type ?? '').slice(0, 40),
    })),
    built_in_tools: Object.entries(p.built_in_tools ?? {})
      .filter(([, value]) => value)
      .map(([key, value]) => ({
        key: key.slice(0, 80),
        type: String(value?.type ?? '').slice(0, 40),
      })),
    workflow_node_types: nodes.map((node) => String(node?.type ?? '').slice(0, 40)),
    workflow_edge_count: Object.keys(config?.workflow?.edges ?? {}).length,
  };
}
// ElevenLabs gives every agent a placeholder workflow (a lone start node), so "zero nodes"
// can never pass: the live Ana agents only verified once this rule shipped. With no edges
// nothing can leave the main agent, so only start/end nodes are allowed.
function workflowIsEmpty(workflow) {
  if (Object.keys(workflow?.edges ?? {}).length) return false;
  return Object.values(workflow?.nodes ?? {}).every((node) => ['start', 'end'].includes(node?.type));
}
// Line endings and edge whitespace are the only provider normalization accepted.
const text = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();
export function agentConfigFailures(config, route) {
  if (!config || typeof config !== 'object') return ['provider_read'];
  if (config.agent_id !== route.provider_agent_id || config.agent_id === PLW_AGENT_ID)
    return ['agent_identity'];
  const failures = [];
  const agent = config.conversation_config?.agent;
  const p = agent?.prompt;
  if (text(agent?.first_message) !== text(DENTAL_FIRST_MESSAGE)) failures.push('first_message');
  if (agent?.language !== 'es') failures.push('language');
  if (config.conversation_config?.tts?.model_id !== SALES_VOICE_MODEL) failures.push('voice_model');
  if (
    config.conversation_config?.vad?.background_voice_detection !== true ||
    config.conversation_config?.turn?.turn_eagerness !== 'patient'
  )
    failures.push('noise_settings');
  if (!text(p?.prompt).startsWith(text(salesPrompt({ dentalMode: true })))) failures.push('prompt_base');
  if (!text(p?.prompt).includes(SALES_SCRIPT_VERSION)) failures.push('script_version');
  if (p?.tool_ids?.length || p?.mcp_server_ids?.length || p?.knowledge_base?.length || (p?.tools ?? []).some((tool) => tool?.type !== 'system'))
    failures.push('extra_tools_or_knowledge');
  if (!workflowIsEmpty(config.workflow)) failures.push('workflow');
  const built = p?.built_in_tools ?? {};
  if (
    Object.entries(built).some(
      ([name, value]) =>
        value && !['end_call', 'transfer_to_number', 'voicemail_detection'].includes(name)
    )
  )
    failures.push('extra_builtin_tool');
  if (!built.voicemail_detection) failures.push('voicemail_detection');
  const t = built.transfer_to_number?.params?.transfers;
  if (!Array.isArray(t) || t.length !== 1) failures.push('transfer_count');
  else {
    if (t[0].transfer_type !== 'sip_refer') failures.push('transfer_type');
    if (t[0].transfer_destination?.type !== 'sip_uri') failures.push('transfer_destination_type');
    if (t[0].transfer_destination?.sip_uri !== route.transfer_uri) failures.push('transfer_destination');
    const h = t[0].custom_sip_headers;
    if (
      !Array.isArray(h) ||
      h.length !== 1 ||
      ['type', 'key', 'value'].some((field) => h[0]?.[field] !== TRANSFER_HEADER[field])
    )
      failures.push('transfer_headers');
  }
  return failures;
}
export function safeAgent(config, route) {
  return agentConfigFailures(config, route).length === 0;
}
export function conversationUpdate(data, call, now = new Date().toISOString()) {
  if (
    data?.agent_id !== call.provider_agent_id ||
    data?.conversation_id !== call.conversation_id ||
    data?.conversation_initiation_client_data?.dynamic_variables?.plw_dental_call_id !== call.id
  )
    return null;
  const source = Array.isArray(data.transcript) ? data.transcript : [];
  const requested = source.some((t) =>
    (t.tool_calls ?? []).some((c) =>
      [c.tool_name, c.name, c.function?.name].includes('transfer_to_number')
    )
  );
  const transcript = source.slice(0, 500).map((t) => ({
    role: t.role === 'agent' ? 'agent' : 'user',
    message: String(t.message ?? '').slice(0, 10000),
    time_in_call_secs: Number(t.time_in_call_secs) || 0,
    tools: (t.tool_calls ?? [])
      .map((c) => String(c.tool_name ?? c.name ?? c.function?.name ?? ''))
      .filter(Boolean),
  }));
  const result = {
    transcript,
    summary: String(data.analysis?.transcript_summary ?? '').slice(0, 6000),
    synced_at: now,
    transfer_status:
      call.transfer_status === 'agent_confirmed'
        ? 'agent_confirmed'
        : requested
          ? 'requested'
          : call.transfer_status,
  };
  if (['done', 'failed'].includes(data.status)) {
    result.state = data.status === 'done' ? 'completed' : 'failed';
    result.finished_at = call.finished_at || now;
  }
  return result;
}
