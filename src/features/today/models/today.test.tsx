import { expect, test } from 'vitest';
import { buildDemoProspects } from '@/demo/fixtures/prospects';
import type { AiCall } from '@/features/ai-calls/models/aiCall';
import { buildTodayItems } from '@/features/today/models/today';

const NOW = new Date('2026-11-16T15:00:00Z'); // 9:00 in Costa Rica
const [A, B, C] = buildDemoProspects(NOW).map((prospect) => ({ ...prospect, phone: '8888-0000' }));
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const aiCall = {
  id: 'r1',
  prospectId: C.id,
  callStartedAt: at(-30),
  businessName: 'Llamó',
} as AiCall;

test('one list, most urgent first, each customer once', () => {
  const items = buildTodayItems(
    {
      prospects: [A, B, C],
      followups: [
        {
          id: 'today',
          prospectId: A.id,
          agentId: 'agent-1',
          kind: 'callback',
          title: 'Hoy',
          dueAt: at(120),
          completed: false,
        },
        {
          id: 'late',
          prospectId: B.id,
          agentId: 'agent-1',
          kind: 'callback',
          title: 'Tarde',
          dueAt: at(-60),
          completed: false,
        },
        {
          id: 'done',
          prospectId: B.id,
          agentId: 'agent-1',
          kind: 'email',
          title: 'Hecho',
          dueAt: at(-90),
          completed: true,
        },
        {
          id: 'tomorrow',
          prospectId: A.id,
          agentId: 'agent-1',
          kind: 'meeting',
          title: 'Mañana',
          dueAt: at(24 * 60),
          completed: false,
        },
      ],
      conversations: [
        // C's AI call already lists the customer; A's unread email is new.
        {
          id: 'cc',
          prospectId: C.id,
          assignedAgentId: null,
          subject: 'IA',
          status: 'waiting_agent',
          unread: true,
          lastMessageAt: at(-30),
        },
        {
          id: 'ca',
          prospectId: A.id,
          assignedAgentId: null,
          subject: 'Correo',
          status: 'waiting_agent',
          unread: true,
          lastMessageAt: at(-5),
        },
        {
          id: 'cb',
          prospectId: B.id,
          assignedAgentId: null,
          subject: 'Leído',
          status: 'waiting_agent',
          unread: false,
          lastMessageAt: at(-1),
        },
      ],
      aiCalls: [aiCall],
    },
    NOW
  );

  expect(items.map((item) => [item.kind, item.detail || item.title])).toEqual([
    ['ai_call', 'Llamó'],
    ['overdue', 'Tarde'],
    ['unread', 'Correo'],
    ['due_today', 'Hoy'],
  ]);
  expect(items[1]).toMatchObject({ prospectId: B.id, phone: '8888-0000', followupId: 'late' });
});
