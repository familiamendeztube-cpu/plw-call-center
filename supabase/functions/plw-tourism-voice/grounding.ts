// Grounded answer registry for plw-tourism-voice. The voice endpoint only synthesizes
// short lines derived from the confirmed draft (or fixed UI labels) — never arbitrary
// caller-supplied text. Each answer id maps to a builder over the allowed draft fields.

export interface FaqPair {
  question: string;
  answer: string;
}

export interface SecretaryProfile {
  businessName: string;
  // tourism | restaurant | retail | services; drives the sales line examples.
  businessType: string;
}

export interface AnswerContext {
  businessName: string;
  locale: string;
  category: string;
  services: string[];
  highlight: string;
  description: string;
  faqs: FaqPair[];
  secretary?: SecretaryProfile;
}

export const ANSWER_IDS = ['welcome', 'services', 'location', 'about'] as const;

export const SECRETARY_IDS = [
  'secretary-welcome',
  'secretary-intro',
  'secretary-orders',
  'secretary-after-hours',
  'secretary-language',
] as const;

export type AnswerId = (typeof ANSWER_IDS)[number] | (typeof SECRETARY_IDS)[number];

const FAQ_PATTERN = /^faq:([0-9]{1,2})$/;

// Mandarin audio for the language line; Spanish and English get their spoken lines.
export const SECRETARY_MANDARIN = 'zh';

export function isAnswerId(value: unknown): value is AnswerId | `faq:${number}` {
  if (typeof value !== 'string') return false;
  if ((ANSWER_IDS as readonly string[]).includes(value)) return true;
  if ((SECRETARY_IDS as readonly string[]).includes(value)) return true;
  return FAQ_PATTERN.test(value);
}

// Control characters and backticks never reach the voice: draft text is agent-typed but
// still escaped defensively before it is spoken.
function spoken(raw: string): string {
  return raw
    .replace(/[`$\\]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Per-type capability examples for the secretary sales demo. These describe what the
// DEMO shows; they never promise a real booking and never mention a phone number.
const TYPE_LINES: Record<string, { es: string; en: string; zh: string }> = {
  tourism: {
    es: 'Puede preguntar por tours, horarios y disponibilidad, y escuchar cómo serían las reservas.',
    en: 'You can ask about tours, schedules and availability, and hear how reservations would work.',
    zh: '您可以询问旅游、时间表和空位情况，并了解预订流程。'.replace('，并了解预订流程。', '，并听取预订示例。'),
  },
  restaurant: {
    es: 'Puede preguntar por el menú y escuchar cómo se tomarían los pedidos.',
    en: 'You can ask about the menu and hear how orders would be taken.',
    zh: '您可以询问菜单，并听取点单示例。',
  },
  retail: {
    es: 'Puede preguntar por productos y escuchar cómo se atendería una venta.',
    en: 'You can ask about products and hear how a sale would be handled.',
    zh: '您可以询问产品，并听取售前咨询示例。',
  },
  services: {
    es: 'Puede preguntar por los servicios y escuchar cómo se agendarían las citas.',
    en: 'You can ask about the services and hear how appointments would be scheduled.',
    zh: '您可以询问服务项目，并听取预约示例。',
  },
};

function typeLine(type: string, language: 'es' | 'en' | 'zh'): string {
  return TYPE_LINES[type]?.[language] ?? TYPE_LINES['services'][language];
}

function secretaryContext(ctx: AnswerContext): { name: string; type: string } {
  const name = spoken(ctx.secretary?.businessName || ctx.businessName);
  const type = ctx.secretary?.businessType || 'services';
  return { name, type: TYPE_LINES[type] ? type : 'services' };
}

export function buildAnswer(
  id: AnswerId | `faq:${number}`,
  language: 'es' | 'en',
  ctx: AnswerContext
): string | null {
  const faqMatch = FAQ_PATTERN.exec(id);
  if (faqMatch) {
    const index = Number(faqMatch[1]);
    const faq = ctx.faqs[index];
    if (!faq || faq.answer.trim() === '') return null;
    return faq.answer.trim().slice(0, 400);
  }

  if ((SECRETARY_IDS as readonly string[]).includes(id)) {
    return buildSecretary(id as (typeof SECRETARY_IDS)[number], language, ctx);
  }

  const name = ctx.businessName.trim();
  if (!name) return null;
  const place = ctx.locale.trim();
  const services = ctx.services.filter((s) => s.trim() !== '').slice(0, 5);

  if (id === 'welcome') {
    return language === 'es'
      ? `Bienvenido a la muestra del sitio de ${spoken(name)}${place ? `, en ${spoken(place)}` : ''}.`
      : `Welcome to the sample website of ${spoken(name)}${place ? `, in ${spoken(place)}` : ''}.`;
  }
  if (id === 'services') {
    if (services.length === 0) return null;
    const list = spoken(services.join(', '));
    return language === 'es'
      ? `${spoken(name)} ofrece: ${list}.`
      : `${spoken(name)} offers: ${list}.`;
  }
  if (id === 'location') {
    if (!place) return null;
    return language === 'es'
      ? `Puede encontrar a ${spoken(name)} en ${spoken(place)}.`
      : `You can find ${spoken(name)} in ${spoken(place)}.`;
  }
  // about
  const about = ctx.description.trim() || ctx.highlight.trim();
  if (!about) return null;
  return spoken(about).slice(0, 400);
}

// Fixed secretary demo script. Only the saved public business name and the type-selected
// capability line are spoken; 24/7 describes the demo's availability, never a booking promise.
function buildSecretary(
  id: (typeof SECRETARY_IDS)[number],
  language: 'es' | 'en',
  ctx: AnswerContext
): string | null {
  const { name, type } = secretaryContext(ctx);
  if (!name) return null;

  if (id === 'secretary-welcome') {
    // One sentence, Spanish regardless of the UI language of the page.
    return `Hola, ¿cómo está? Gracias por visitar ${name}.`;
  }
  if (id === 'secretary-intro') {
    return language === 'es'
      ? `Soy la asistente virtual de ${name}. ${typeLine(type, 'es')} Esta es una demostración de voz, disponible las 24 horas, sin compromiso.`
      : `I am the virtual assistant of ${name}. ${typeLine(type, 'en')} This is a voice demo, available 24/7, with no commitment.`;
  }
  if (id === 'secretary-orders') {
    return language === 'es'
      ? typeLine(type, 'es')
      : typeLine(type, 'en');
  }
  if (id === 'secretary-after-hours') {
    return language === 'es'
      ? `Fuera del horario, la asistente atiende las 24 horas: recibe el mensaje y ${name} responde al día siguiente. En esta demostración no se hacen reservas reales.`
      : `After hours, the assistant answers 24/7: it takes the message and ${name} follows up the next day. This demo makes no real bookings.`;
  }
  // secretary-language: es and en speak; zh (Mandarin) uses the same voice profile.
  if (id === 'secretary-language') {
    if (language === 'es') return `También puedo atenderle en inglés y en mandarín, con la misma voz.`;
    if (language === 'en') return `I can also assist you in Spanish and Mandarin, with the same voice.`;
    return null; // Mandarin text is provided by the caller-facing zh branch, not here.
  }
  return null;
}

// Mandarin line for secretary-language + language zh (same voice profile, no separate voice).
export function buildMandarinLine(id: string, ctx: AnswerContext): string | null {
  if (id !== 'secretary-language') return null;
  const { name, type } = secretaryContext(ctx);
  if (!name) return null;
  return `您好，我是${name}的语音助理。${typeLine(type, 'zh')} 此演示全天候开放，仅供参考。`;
}
