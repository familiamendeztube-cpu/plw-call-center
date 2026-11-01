import { supabaseConfigMissing } from '@/integrations/supabase/client';

export type AppMode =
  | { kind: 'demo' }
  | { kind: 'production' }
  | { kind: 'setup-required'; missingKeys: string[]; modeUnset: boolean };

function resolveAppMode(): AppMode {
  const configuredMode = import.meta.env.VITE_PLW_AUTH_MODE;

  if (configuredMode === 'demo') return { kind: 'demo' };

  if (configuredMode === 'production') {
    if (supabaseConfigMissing.length > 0) {
      return { kind: 'setup-required', missingKeys: supabaseConfigMissing, modeUnset: false };
    }
    return { kind: 'production' };
  }

  if (configuredMode === undefined && !import.meta.env.PROD) return { kind: 'demo' };

  return { kind: 'setup-required', missingKeys: [], modeUnset: true };
}

export const APP_MODE: AppMode = resolveAppMode();

export const IS_DEMO_MODE = APP_MODE.kind === 'demo';
