import { formatDateTime } from '@/app/dates';
import { buildAgentNameMap } from '@/features/admin/models/lookups';
import type { AdminSnapshot } from '@/features/admin/models/overview';
import {
  ASSIGNMENT_MECHANISM_LABELS,
  type AssignmentBoard,
} from '@/features/assignment/models/assignment';
import { SALES_STAGE_LABELS } from '@/features/leads/models/prospect';

export interface AssignmentRow {
  id: string;
  prospectId: string | null;
  title: string;
  detail: string;
  meta: string;
  note: string | null;
}

export interface AssignmentViews {
  waiting: AssignmentRow[];
  assigned: AssignmentRow[];
  overdue: AssignmentRow[];
  history: AssignmentRow[];
}

const UNASSIGNED_LABEL = 'Sin responsable';
const UNKNOWN_PROSPECT_LABEL = 'Prospecto no disponible';

export function buildAssignmentViews(
  snapshot: AdminSnapshot,
  board: AssignmentBoard
): AssignmentViews {
  const agentNames = buildAgentNameMap(snapshot.agents);
  const prospects = new Map(snapshot.prospects.map((prospect) => [prospect.id, prospect]));
  const ownerName = (ownerId: string | null) =>
    ownerId === null ? UNASSIGNED_LABEL : (agentNames[ownerId] ?? ownerId);

  const waiting = board.waiting.flatMap((entry): AssignmentRow[] => {
    const prospect = prospects.get(entry.prospectId);
    if (!prospect) return [];
    return [
      {
        id: `waiting-${entry.prospectId}`,
        prospectId: prospect.id,
        title: prospect.businessName,
        detail: `${prospect.contactName} · ${prospect.serviceInterest}`,
        meta: `En cola desde ${formatDateTime(entry.queuedAt)}`,
        note: null,
      },
    ];
  });

  const assigned = snapshot.prospects
    .filter((prospect) => prospect.assignedAgentId !== null)
    .sort((first, second) => first.businessName.localeCompare(second.businessName))
    .map((prospect): AssignmentRow => ({
      id: `assigned-${prospect.id}`,
      prospectId: prospect.id,
      title: prospect.businessName,
      detail: `Responsable: ${ownerName(prospect.assignedAgentId)} · ${SALES_STAGE_LABELS[prospect.stage]}`,
      meta: `Creado ${formatDateTime(prospect.createdAt)}`,
      note: null,
    }));

  const overdue = board.overdue.map((entry): AssignmentRow => ({
    id: `overdue-${entry.conversationId}`,
    prospectId: entry.prospectId,
    title: prospects.get(entry.prospectId)?.businessName ?? UNKNOWN_PROSPECT_LABEL,
    detail: `Responsable: ${ownerName(entry.ownerId)}`,
    meta: `Último mensaje ${formatDateTime(entry.lastMessageAt)}`,
    note: null,
  }));

  const history = board.history.map((entry): AssignmentRow => ({
    id: `history-${entry.id}`,
    prospectId: null,
    title: prospects.get(entry.prospectId)?.businessName ?? UNKNOWN_PROSPECT_LABEL,
    detail: `${ownerName(entry.fromOwnerId)} → ${ownerName(entry.toOwnerId)} · ${ASSIGNMENT_MECHANISM_LABELS[entry.mechanism]}`,
    meta: formatDateTime(entry.createdAt),
    note: entry.reason,
  }));

  return { waiting, assigned, overdue, history };
}
