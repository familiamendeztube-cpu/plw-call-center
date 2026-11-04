import { isAgentId, type AgentId } from '@/features/auth/models/agent';
import type { Conversation, ConversationStatus, Draft } from '@/features/inbox/models/conversation';
import type { Message, MessageAuthor } from '@/features/inbox/models/message';
import type { PrivateNote } from '@/features/leads/models/note';
import { PAYMENT_STATUSES, SALES_STAGES, type Prospect } from '@/features/leads/models/prospect';
import type { Followup, FollowupKind } from '@/features/followups/models/followup';
import type {
  MaterialApproval,
  MaterialKind,
  SalesMaterial,
} from '@/features/sales-materials/models/material';
import type {
  AssignmentHistoryEntry,
  AssignmentMechanism,
  OverdueEntry,
  WaitingEntry,
} from '@/features/assignment/models/assignment';
import {
  readBoolean,
  readEnum,
  readNullableString,
  readString,
} from '@/production/adapters/productionRows';

const CONVERSATION_STATUSES: readonly ConversationStatus[] = [
  'waiting_agent',
  'waiting_customer',
  'closed',
];
const MESSAGE_AUTHORS: readonly MessageAuthor[] = ['customer', 'agent'];
const FOLLOWUP_KINDS: readonly FollowupKind[] = ['callback', 'email', 'meeting'];
const MATERIAL_KINDS: readonly MaterialKind[] = [
  'presentation',
  'video',
  'demonstration',
  'email_template',
  'pricing',
];
const MATERIAL_APPROVALS: readonly MaterialApproval[] = ['approved', 'awaiting_configuration'];

function readAgentId(row: Record<string, unknown>, key: string): AgentId {
  const value = readString(row, key);
  if (!isAgentId(value)) {
    throw new Error(`Fila inválida: el campo ${key} no es un agente válido.`);
  }
  return value;
}

function readNullableAgentId(row: Record<string, unknown>, key: string): AgentId | null {
  const value = readNullableString(row, key);
  if (value === null) return null;
  if (!isAgentId(value)) {
    throw new Error(`Fila inválida: el campo ${key} no es un agente válido.`);
  }
  return value;
}

export function toProspect(row: Record<string, unknown>): Prospect {
  return {
    id: readString(row, 'id'),
    businessName: readString(row, 'business_name'),
    contactName: readString(row, 'contact_name'),
    email: readString(row, 'email'),
    phone: readString(row, 'phone'),
    businessCategory: readString(row, 'business_category'),
    serviceInterest: readString(row, 'service_interest'),
    source: readString(row, 'source'),
    assignedAgentId: readNullableAgentId(row, 'owner_id'),
    stage: readEnum(row, 'stage', SALES_STAGES),
    paymentStatus: readEnum(row, 'payment_status', PAYMENT_STATUSES),
    nextAction: readString(row, 'next_action'),
    nextFollowUpAt: readNullableString(row, 'next_follow_up_at'),
    createdAt: readString(row, 'created_at'),
  };
}

export function toConversation(row: Record<string, unknown>): Conversation {
  const prospect = row['prospects'];
  if (prospect === null || typeof prospect !== 'object') {
    throw new Error('Fila inválida: falta el prospecto de la conversación.');
  }
  return {
    id: readString(row, 'id'),
    prospectId: readString(row, 'prospect_id'),
    assignedAgentId: readNullableAgentId(prospect as Record<string, unknown>, 'owner_id'),
    subject: readString(row, 'subject'),
    status: readEnum(row, 'status', CONVERSATION_STATUSES),
    unread: readBoolean(row, 'unread'),
    lastMessageAt: readString(row, 'last_message_at'),
  };
}

export function toMessage(row: Record<string, unknown>): Message {
  return {
    id: readString(row, 'id'),
    conversationId: readString(row, 'conversation_id'),
    author: readEnum(row, 'author', MESSAGE_AUTHORS),
    body: readString(row, 'body'),
    sentAt: readString(row, 'sent_at'),
  };
}

export function toDraft(row: Record<string, unknown>): Draft {
  const revision = row.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    throw new Error('Fila inválida: el campo revision no es un número.');
  }
  return {
    conversationId: readString(row, 'conversation_id'),
    body: readString(row, 'body'),
    updatedAt: readString(row, 'updated_at'),
    revision,
  };
}

export function toNote(row: Record<string, unknown>): PrivateNote {
  return {
    id: readString(row, 'id'),
    prospectId: readString(row, 'prospect_id'),
    agentId: readAgentId(row, 'author_id'),
    body: readString(row, 'body'),
    createdAt: readString(row, 'created_at'),
  };
}

export function toFollowup(row: Record<string, unknown>): Followup {
  return {
    id: readString(row, 'id'),
    prospectId: readString(row, 'prospect_id'),
    agentId: readAgentId(row, 'agent_id'),
    kind: readEnum(row, 'kind', FOLLOWUP_KINDS),
    title: readString(row, 'title'),
    dueAt: readString(row, 'due_at'),
    completed: readBoolean(row, 'completed'),
  };
}

export function toMaterial(row: Record<string, unknown>): SalesMaterial {
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    description: readString(row, 'description'),
    kind: readEnum(row, 'kind', MATERIAL_KINDS),
    approval: readEnum(row, 'approval', MATERIAL_APPROVALS),
    url: readNullableString(row, 'url'),
    updatedAt: readString(row, 'updated_at'),
  };
}

const ASSIGNMENT_MECHANISMS: readonly AssignmentMechanism[] = ['round_robin', 'manual'];

export function toWaitingEntry(row: Record<string, unknown>): WaitingEntry {
  return {
    prospectId: readString(row, 'prospect_id'),
    queuedAt: readString(row, 'queued_at'),
  };
}

export function toOverdueEntry(row: Record<string, unknown>): OverdueEntry {
  return {
    conversationId: readString(row, 'conversation_id'),
    prospectId: readString(row, 'prospect_id'),
    ownerId: readNullableAgentId(row, 'owner_id'),
    lastMessageAt: readString(row, 'last_message_at'),
  };
}

export function toAssignmentHistoryEntry(row: Record<string, unknown>): AssignmentHistoryEntry {
  // assignment_history.id is a bigint, which PostgREST sends as a JSON number.
  if (typeof row.id !== 'number' && typeof row.id !== 'string') {
    throw new Error('Fila inválida: el campo id no es un identificador.');
  }
  return {
    id: String(row.id),
    prospectId: readString(row, 'prospect_id'),
    fromOwnerId: readNullableAgentId(row, 'from_owner_id'),
    toOwnerId: readNullableAgentId(row, 'to_owner_id'),
    mechanism: readEnum(row, 'mechanism', ASSIGNMENT_MECHANISMS),
    reason: readNullableString(row, 'reason'),
    createdAt: readString(row, 'created_at'),
  };
}
