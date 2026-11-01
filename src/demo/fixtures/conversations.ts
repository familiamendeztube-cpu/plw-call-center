import type { Conversation, Draft } from '@/features/inbox/models/conversation';
import type { Message } from '@/features/inbox/models/message';
import { hoursFrom } from '@/demo/fixtures/time';

export interface DemoConversationData {
  conversations: Conversation[];
  messages: Message[];
  drafts: Draft[];
}

export function buildDemoConversations(now: Date): DemoConversationData {
  const conversations: Conversation[] = [
    {
      id: 'conv-cedros',
      prospectId: 'prospect-cedros',
      assignedAgentId: 'agent-1',
      subject: 'Consulta sobre pedidos por WhatsApp',
      status: 'waiting_agent',
      unread: true,
      lastMessageAt: hoursFrom(now, -1),
    },
    {
      id: 'conv-martillo',
      prospectId: 'prospect-martillo',
      assignedAgentId: 'agent-2',
      subject: 'Planes para tres sucursales',
      status: 'waiting_agent',
      unread: true,
      lastMessageAt: hoursFrom(now, -0.5),
    },
    {
      id: 'conv-sol',
      prospectId: 'prospect-sol-tropical',
      assignedAgentId: 'agent-3',
      subject: 'Horario de la demostración',
      status: 'waiting_customer',
      unread: false,
      lastMessageAt: hoursFrom(now, -10),
    },
    {
      id: 'conv-rias',
      prospectId: 'prospect-rias',
      assignedAgentId: 'agent-1',
      subject: 'Dudas sobre la propuesta',
      status: 'waiting_agent',
      unread: false,
      lastMessageAt: hoursFrom(now, -26),
    },
    {
      id: 'conv-monteverde',
      prospectId: 'prospect-monteverde',
      assignedAgentId: 'agent-2',
      subject: 'Reservas en línea',
      status: 'waiting_customer',
      unread: false,
      lastMessageAt: hoursFrom(now, -4),
    },
    {
      id: 'conv-cartago',
      prospectId: 'prospect-cartago',
      assignedAgentId: 'agent-3',
      subject: 'Capacitación del equipo',
      status: 'closed',
      unread: false,
      lastMessageAt: hoursFrom(now, -90),
    },
    {
      id: 'conv-brisas',
      prospectId: 'prospect-brisas',
      assignedAgentId: null,
      subject: 'Matrícula en línea para el próximo ciclo',
      status: 'waiting_agent',
      unread: true,
      lastMessageAt: hoursFrom(now, -2),
    },
    {
      id: 'conv-cafe-valle',
      prospectId: 'prospect-cafe-valle',
      assignedAgentId: null,
      subject: 'Solicitud de información de distribución',
      status: 'waiting_agent',
      unread: true,
      lastMessageAt: hoursFrom(now, -1),
    },
  ];

  const messages: Message[] = [
    {
      id: 'msg-cedros-1',
      conversationId: 'conv-cedros',
      author: 'customer',
      body: 'Buenos días. Recibimos sus datos por el formulario web. Nos interesa ordenar los pedidos de clientes por WhatsApp sin perder tiempo en el teléfono.',
      sentAt: hoursFrom(now, -3),
    },
    {
      id: 'msg-cedros-2',
      conversationId: 'conv-cedros',
      author: 'agent',
      body: 'Buenos días, María Fernanda. Con gusto le muestro cómo funciona. ¿Le funcionaría una demostración de 20 minutos esta semana?',
      sentAt: hoursFrom(now, -2.5),
    },
    {
      id: 'msg-cedros-3',
      conversationId: 'conv-cedros',
      author: 'customer',
      body: 'Sí, pero necesito confirmar con la gerencia. ¿Podrían enviarme la propuesta antes del jueves?',
      sentAt: hoursFrom(now, -1),
    },
    {
      id: 'msg-martillo-1',
      conversationId: 'conv-martillo',
      author: 'customer',
      body: 'Hola, tenemos tres sucursales en Cartago, Alajuela y San José. ¿Cómo se manejan los precios por sede?',
      sentAt: hoursFrom(now, -0.5),
    },
    {
      id: 'msg-sol-1',
      conversationId: 'conv-sol',
      author: 'agent',
      body: 'Dra. Chaves, le confirmo la demostración del módulo de citas para el martes a las 10:00 a. m.',
      sentAt: hoursFrom(now, -12),
    },
    {
      id: 'msg-sol-2',
      conversationId: 'conv-sol',
      author: 'customer',
      body: 'Perfecto, gracias. Por favor incluya el recordatorio por correo electrónico.',
      sentAt: hoursFrom(now, -10),
    },
    {
      id: 'msg-rias-1',
      conversationId: 'conv-rias',
      author: 'agent',
      body: 'Luis, le envié la propuesta con el alcance de rutas y rastreo. Quedo atento a cualquier duda.',
      sentAt: hoursFrom(now, -30),
    },
    {
      id: 'msg-rias-2',
      conversationId: 'conv-rias',
      author: 'customer',
      body: 'Recibida. Tengo una pregunta sobre el costo de la instalación en los dispositivos GPS.',
      sentAt: hoursFrom(now, -26),
    },
    {
      id: 'msg-monteverde-1',
      conversationId: 'conv-monteverde',
      author: 'customer',
      body: 'Buenas tardes, la gerencia está revisando el canal de reservas. Les avisamos la próxima semana.',
      sentAt: hoursFrom(now, -4),
    },
    {
      id: 'msg-cartago-1',
      conversationId: 'conv-cartago',
      author: 'customer',
      body: 'Gracias por la gestión. Podemos iniciar la capacitación el próximo mes.',
      sentAt: hoursFrom(now, -90),
    },
    {
      id: 'msg-brisas-1',
      conversationId: 'conv-brisas',
      author: 'customer',
      body: '¿Cuándo abre el proceso de matrícula en línea para el próximo ciclo? Necesitamos orientar a las familias.',
      sentAt: hoursFrom(now, -2),
    },
    {
      id: 'msg-cafe-valle-1',
      conversationId: 'conv-cafe-valle',
      author: 'customer',
      body: 'Buen día. Distribuimos café a restaurantes de la región central. ¿Tienen una solución para pedidos recurrentes?',
      sentAt: hoursFrom(now, -1),
    },
  ];

  const drafts: Draft[] = [
    {
      conversationId: 'conv-cedros',
      body: 'Buenos días, María Fernanda. Le comparto la propuesta y dos horarios disponibles para la demostración: ',
      updatedAt: hoursFrom(now, -0.4),
      revision: 1,
    },
  ];

  return { conversations, messages, drafts };
}
