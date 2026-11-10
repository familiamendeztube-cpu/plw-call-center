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
  method = body ? 'POST' : 'GET'
) {
  const response = await fetchImpl(ROOT + path, {
    method,
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
          mcp_server_ids: [],
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
  if (!text(p?.prompt).startsWith(text(salesPrompt({ dentalMode: true })))) failures.push('prompt_base');
  if (!text(p?.prompt).includes(SALES_SCRIPT_VERSION)) failures.push('script_version');
  if (p?.tool_ids?.length || p?.mcp_server_ids?.length || p?.knowledge_base?.length || (p?.tools ?? []).some((tool) => tool?.type !== 'system'))
    failures.push('extra_tools_or_knowledge');
  if (Object.keys(config.workflow?.nodes ?? {}).length) failures.push('workflow');
  const built = p?.built_in_tools ?? {};
  if (
    Object.entries(built).some(
      ([name, value]) => value && !['end_call', 'transfer_to_number'].includes(name)
    )
  )
    failures.push('extra_builtin_tool');
  const t = built.transfer_to_number?.params?.transfers;
  if (!Array.isArray(t) || t.length !== 1) failures.push('transfer_count');
  else {
    if (t[0].transfer_type !== 'sip_refer') failures.push('transfer_type');
    if (t[0].transfer_destination?.type !== 'sip_uri') failures.push('transfer_destination_type');
    if (t[0].transfer_destination?.sip_uri !== route.transfer_uri) failures.push('transfer_destination');
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
