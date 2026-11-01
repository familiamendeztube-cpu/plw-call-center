import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigMissing: string[] = [
  ...(supabaseUrl ? [] : ['VITE_SUPABASE_URL']),
  ...(supabaseAnonKey ? [] : ['VITE_SUPABASE_ANON_KEY']),
];

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase no está configurado.');
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

export const supabaseFunctionsUrl = `${supabaseUrl ?? ''}/functions/v1`;
export const supabaseAnonKeyValue = supabaseAnonKey ?? '';
