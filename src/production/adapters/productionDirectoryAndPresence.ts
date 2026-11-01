import { isAgentId, type Agent } from '@/features/auth/models/agent';
import type { AgentDirectory } from '@/features/auth/services/agentDirectory';
import type { ActivityEvent, ActivityKind } from '@/features/presence/models/activity';
import type { AgentPresence, Availability } from '@/features/presence/models/availability';
import type { PresenceService } from '@/features/presence/services/presenceService';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { readBoolean, readRows, readString } from '@/production/adapters/productionRows';

const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'call',
  'note',
  'followup',
  'message',
  'stage_change',
  'assignment',
];

function toAvailability(value: string): Availability {
  if (value === 'active' || value === 'paused') return value;
  throw new Error('Disponibilidad inválida del servicio.');
}

function toActivityKind(value: string): ActivityKind {
  const match = ACTIVITY_KINDS.find((kind) => kind === value);
  if (!match) throw new Error('Tipo de actividad inválido del servicio.');
  return match;
}

export function createProductionAgentDirectory(): AgentDirectory {
  return {
    async listAgents(): Promise<Agent[]> {
      const { data, error } = await getSupabaseClient().rpc('public_agent_directory');
      if (error) throw new Error('No se pudo cargar la lista de agentes.');
      const agents: Agent[] = [];
      for (const row of readRows(data)) {
        if (!readBoolean(row, 'is_enabled')) continue;
        const id = readString(row, 'id');
        if (!isAgentId(id)) continue;
        agents.push({ id, displayName: readString(row, 'display_name') });
      }
      return agents;
    },
  };
}

export function createProductionPresenceService(): PresenceService {
  return {
    async listPresence(): Promise<AgentPresence[]> {
      const { data, error } = await getSupabaseClient()
        .from('staff_presence')
        .select('staff_id, availability, updated_at');
      if (error) throw new Error('No se pudo cargar la disponibilidad.');
      const entries: AgentPresence[] = [];
      for (const row of readRows(data)) {
        const agentId = readString(row, 'staff_id');
        if (!isAgentId(agentId)) continue;
        entries.push({
          agentId,
          availability: toAvailability(readString(row, 'availability')),
          updatedAt: readString(row, 'updated_at'),
        });
      }
      return entries;
    },

    async setAvailability(agentId, availability) {
      const { data, error } = await getSupabaseClient().rpc('set_availability', {
        p_availability: availability,
      });
      if (error) throw new Error('No se pudo actualizar tu disponibilidad.');
      return {
        agentId,
        availability: toAvailability(String(data)),
        updatedAt: new Date().toISOString(),
      };
    },

    async sendHeartbeat() {
      const { error } = await getSupabaseClient().rpc('record_heartbeat');
      if (error) throw new Error('No se pudo confirmar tu conexión.');
    },

    async listActivity(agentId): Promise<ActivityEvent[]> {
      let query = getSupabaseClient()
        .from('activity_events')
        .select('id, agent_id, kind, summary, occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(100);
      if (agentId !== null) query = query.eq('agent_id', agentId);
      const { data, error } = await query;
      if (error) throw new Error('No se pudo cargar la actividad.');
      const events: ActivityEvent[] = [];
      for (const row of readRows(data)) {
        const eventAgentId = readString(row, 'agent_id');
        if (!isAgentId(eventAgentId)) continue;
        events.push({
          id: readString(row, 'id'),
          agentId: eventAgentId,
          kind: toActivityKind(readString(row, 'kind')),
          summary: readString(row, 'summary'),
          occurredAt: readString(row, 'occurred_at'),
        });
      }
      return events;
    },
  };
}
