// Grounded answer registry for plw-tourism-voice. The voice endpoint only synthesizes
// short lines derived from the confirmed draft (or fixed UI labels) — never arbitrary
// caller-supplied text. Each answer id maps to a builder over the allowed draft fields.

export interface AnswerContext {
  businessName: string;
  locale: string;
  category: string;
  services: string[];
  highlight: string;
  description: string;
}

export const ANSWER_IDS = ['welcome', 'services', 'location', 'about'] as const;

export type AnswerId = (typeof ANSWER_IDS)[number];

export function isAnswerId(value: unknown): value is AnswerId {
  return typeof value === 'string' && (ANSWER_IDS as readonly string[]).includes(value);
}

export function buildAnswer(id: AnswerId, language: 'es' | 'en', ctx: AnswerContext): string | null {
  const name = ctx.businessName.trim();
  if (!name) return null;
  const place = ctx.locale.trim();
  const services = ctx.services.filter((s) => s.trim() !== '').slice(0, 5);

  if (id === 'welcome') {
    return language === 'es'
      ? `Bienvenido a la muestra del sitio de ${name}${place ? `, en ${place}` : ''}.`
      : `Welcome to the sample website of ${name}${place ? `, in ${place}` : ''}.`;
  }
  if (id === 'services') {
    if (services.length === 0) return null;
    const list = services.join(', ');
    return language === 'es'
      ? `${name} ofrece: ${list}.`
      : `${name} offers: ${list}.`;
  }
  if (id === 'location') {
    if (!place) return null;
    return language === 'es'
      ? `Puede encontrar a ${name} en ${place}.`
      : `You can find ${name} in ${place}.`;
  }
  // about
  const about = ctx.description.trim() || ctx.highlight.trim();
  if (!about) return null;
  return about.slice(0, 400);
}
