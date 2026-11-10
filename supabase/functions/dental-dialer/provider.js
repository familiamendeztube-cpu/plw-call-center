import {
  DENTAL_FIRST_MESSAGE,
  salesPrompt,
  SALES_SCRIPT_VERSION,
  SALES_VOICE_MODEL,
} from './salesScript.js';
import { PLW_AGENT_ID } from './rules.js';
const ROOT = 'https://api.elevenlabs.io/v1/convai';
export async function providerRequest(apiKey, path, body, fetchImpl = fetch) {
  const response = await fetchImpl(ROOT + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(18000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => null),
  };
}
export function dentalAgentConfig(staffName, route, voiceId) {
  return {
    name: `PLW Dental · Ana · ${staffName} · ${SALES_SCRIPT_VERSION}`,
    tags: ['plw-dental'],
    conversation_config: {
      agent: {
        language: 'es',
        first_message: DENTAL_FIRST_MESSAGE,
        prompt: {
          prompt:
            salesPrompt({ dentalMode: true }) +
            `\nVersión: ${SALES_SCRIPT_VERSION}. Tu único asesor es ${staffName}. Si hay interés, pregunta si desea hablar con ${staffName} ahora. Solo si acepta, usa transfer_to_number hacia ${route.transfer_uri}. Si no acepta, registra que prefiere una devolución de llamada. Nunca transfieras sin aceptación.`,
          tool_ids: [],
          knowledge_base: [],
          built_in_tools: {
            end_call: {
              type: 'system',
              name: 'end_call',
              params: { system_tool_type: 'end_call' },
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
                    custom_sip_headers: [
                      {
                        type: 'dynamic',
                        key: 'X-PLW-Dental-Call',
                        value: '{{plw_dental_call_id}}',
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      tts: { voice_id: voiceId, model_id: SALES_VOICE_MODEL },
      conversation: { max_duration_seconds: 300 },
    },
    platform_settings: {
      data_collection: {
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
export function safeAgent(config, route) {
  if (!config || config.agent_id !== route.provider_agent_id || config.agent_id === PLW_AGENT_ID)
    return false;
  const p = config.conversation_config?.agent?.prompt;
  if (
    config.conversation_config?.agent?.first_message !== DENTAL_FIRST_MESSAGE ||
    config.conversation_config?.agent?.language !== 'es' ||
    config.conversation_config?.tts?.model_id !== SALES_VOICE_MODEL
  )
    return false;
  if (
    !p?.prompt?.startsWith(salesPrompt({ dentalMode: true })) ||
    !p.prompt.includes(SALES_SCRIPT_VERSION) ||
    p.tool_ids?.length ||
    p.mcp_server_ids?.length ||
    p.knowledge_base?.length ||
    (p.tools ?? []).length ||
    Object.keys(config.workflow?.nodes ?? {}).length
  )
    return false;
  const built = p.built_in_tools ?? {};
  if (
    Object.entries(built).some(
      ([name, value]) => value && !['end_call', 'transfer_to_number'].includes(name)
    )
  )
    return false;
  const t = built.transfer_to_number?.params?.transfers;
  return (
    Array.isArray(t) &&
    t.length === 1 &&
    t[0].transfer_type === 'sip_refer' &&
    t[0].transfer_destination?.type === 'sip_uri' &&
    t[0].transfer_destination?.sip_uri === route.transfer_uri
  );
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
