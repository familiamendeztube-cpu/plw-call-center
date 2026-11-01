import type { AgentPresence } from '@/features/presence/models/availability';
import type { ActivityEvent } from '@/features/presence/models/activity';
import type { Followup } from '@/features/followups/models/followup';
import type { PrivateNote } from '@/features/leads/models/note';
import type { SalesMaterial } from '@/features/sales-materials/models/material';
import type { Agent } from '@/features/auth/models/agent';
import { hoursFrom } from '@/demo/fixtures/time';

export const DEMO_AGENTS: Agent[] = [
  { id: 'agent-1', displayName: 'Agente 1' },
  { id: 'agent-2', displayName: 'Agente 2' },
  { id: 'agent-3', displayName: 'Agente 3' },
];

export function buildDemoPresence(now: Date): AgentPresence[] {
  return [
    { agentId: 'agent-1', availability: 'active', updatedAt: hoursFrom(now, -0.2) },
    { agentId: 'agent-2', availability: 'active', updatedAt: hoursFrom(now, -1) },
    { agentId: 'agent-3', availability: 'paused', updatedAt: hoursFrom(now, -0.1) },
  ];
}

export function buildDemoNotes(now: Date): PrivateNote[] {
  return [
    {
      id: 'note-cedros-1',
      prospectId: 'prospect-cedros',
      agentId: 'agent-1',
      body: 'La dueña quiere ver el panel de pedidos antes de hablar de precios. Priorizar la demostración.',
      createdAt: hoursFrom(now, -2),
    },
    {
      id: 'note-rias-1',
      prospectId: 'prospect-rias',
      agentId: 'agent-1',
      body: 'Tienen 42 unidades. Preguntar por el contrato anual de rastreo.',
      createdAt: hoursFrom(now, -25),
    },
  ];
}

export function buildDemoFollowups(now: Date): Followup[] {
  return [
    {
      id: 'fu-cedros',
      prospectId: 'prospect-cedros',
      agentId: 'agent-1',
      kind: 'meeting',
      title: 'Confirmar demostración de pedidos',
      dueAt: hoursFrom(now, 3),
      completed: false,
    },
    {
      id: 'fu-martillo',
      prospectId: 'prospect-martillo',
      agentId: 'agent-2',
      kind: 'callback',
      title: 'Llamada de regreso sobre sucursales',
      dueAt: hoursFrom(now, 1),
      completed: false,
    },
    {
      id: 'fu-rias',
      prospectId: 'prospect-rias',
      agentId: 'agent-1',
      kind: 'email',
      title: 'Resolver dudas de la propuesta',
      dueAt: hoursFrom(now, -4),
      completed: false,
    },
    {
      id: 'fu-monteverde',
      prospectId: 'prospect-monteverde',
      agentId: 'agent-2',
      kind: 'callback',
      title: 'Conocer resultado de la revisión interna',
      dueAt: hoursFrom(now, 6),
      completed: false,
    },
    {
      id: 'fu-sol',
      prospectId: 'prospect-sol-tropical',
      agentId: 'agent-3',
      kind: 'meeting',
      title: 'Demostración del módulo de citas',
      dueAt: hoursFrom(now, 26),
      completed: false,
    },
    {
      id: 'fu-cartago',
      prospectId: 'prospect-cartago',
      agentId: 'agent-3',
      kind: 'email',
      title: 'Enviar agenda de capacitación',
      dueAt: hoursFrom(now, -48),
      completed: true,
    },
  ];
}

export function buildDemoActivity(now: Date): ActivityEvent[] {
  return [
    {
      id: 'act-1',
      agentId: 'agent-1',
      kind: 'message',
      summary: 'Respondió a Panadería Los Cedros Demo',
      occurredAt: hoursFrom(now, -2.5),
    },
    {
      id: 'act-2',
      agentId: 'agent-1',
      kind: 'note',
      summary: 'Agregó una nota privada en Panadería Los Cedros Demo',
      occurredAt: hoursFrom(now, -2),
    },
    {
      id: 'act-3',
      agentId: 'agent-1',
      kind: 'stage_change',
      summary: 'Cambió Transportes Rías del Pacífico Demo a Propuesta enviada',
      occurredAt: hoursFrom(now, -30),
    },
    {
      id: 'act-4',
      agentId: 'agent-2',
      kind: 'followup',
      summary: 'Programó una llamada de regreso con Ferretería El Martillo Azul Demo',
      occurredAt: hoursFrom(now, -1.5),
    },
    {
      id: 'act-5',
      agentId: 'agent-2',
      kind: 'message',
      summary: 'Respondió a Hotel Boutique Bosque Nuboso Demo',
      occurredAt: hoursFrom(now, -4),
    },
    {
      id: 'act-6',
      agentId: 'agent-3',
      kind: 'stage_change',
      summary: 'Cambió Clínica Dental Sol Tropical Demo a Demo agendada',
      occurredAt: hoursFrom(now, -12),
    },
    {
      id: 'act-7',
      agentId: 'agent-3',
      kind: 'stage_change',
      summary: 'Marcó Agencia Creativa Cartago Demo como Ganado',
      occurredAt: hoursFrom(now, -90),
    },
  ];
}

export function buildDemoMaterials(now: Date): SalesMaterial[] {
  return [
    {
      id: 'mat-presentacion-general',
      title: 'Presentación general de PLW',
      description: 'Resumen de servicios, casos de uso y forma de trabajo para primeras reuniones.',
      kind: 'presentation',
      approval: 'approved',
      url: null,
      updatedAt: hoursFrom(now, -200),
    },
    {
      id: 'mat-video-pedidos',
      title: 'Video: automatización de pedidos',
      description:
        'Video de dos minutos que muestra el flujo de pedidos desde el mensaje del cliente.',
      kind: 'video',
      approval: 'approved',
      url: null,
      updatedAt: hoursFrom(now, -120),
    },
    {
      id: 'mat-demo-citas',
      title: 'Demostración: gestión de citas',
      description: 'Entorno de demostración para clínicas y servicios con agenda.',
      kind: 'demonstration',
      approval: 'approved',
      url: null,
      updatedAt: hoursFrom(now, -60),
    },
    {
      id: 'mat-plantilla-propuesta',
      title: 'Plantilla: envío de propuesta',
      description: 'Texto aprobado para enviar una propuesta después de la demostración.',
      kind: 'email_template',
      approval: 'approved',
      url: null,
      updatedAt: hoursFrom(now, -300),
    },
    {
      id: 'mat-plantilla-seguimiento',
      title: 'Plantilla: seguimiento sin respuesta',
      description: 'Mensaje breve y cordial para retomar una conversación pendiente.',
      kind: 'email_template',
      approval: 'approved',
      url: null,
      updatedAt: hoursFrom(now, -300),
    },
    {
      id: 'mat-precios',
      title: 'Precios y servicios',
      description: 'Tarifas y paquetes de servicio.',
      kind: 'pricing',
      approval: 'awaiting_configuration',
      url: null,
      updatedAt: hoursFrom(now, -1),
    },
  ];
}
