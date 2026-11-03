import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const UNAVAILABLE_EXTENSIONS = /CREATE EXTENSION IF NOT EXISTS pg_(net|cron)[^;]*;/gi;

// Only what Supabase provides around the migrations. The tables, policies and
// functions under test are the real ones.
const SUPABASE_PLATFORM = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;

  CREATE SCHEMA extensions;
  CREATE SCHEMA auth;
  CREATE SCHEMA vault;
  CREATE SCHEMA cron;
  CREATE SCHEMA net;
  GRANT USAGE ON SCHEMA extensions, auth TO anon, authenticated, service_role;

  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE auth.sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    not_after timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT (auth.jwt() ->> 'sub')::uuid
  $$;

  CREATE TABLE vault.secrets (name text PRIMARY KEY, secret text);
  CREATE VIEW vault.decrypted_secrets AS SELECT name, secret AS decrypted_secret FROM vault.secrets;
  CREATE FUNCTION vault.create_secret(p_secret text, p_name text, p_description text DEFAULT '')
  RETURNS void LANGUAGE sql AS $$ INSERT INTO vault.secrets VALUES (p_name, p_secret) $$;

  CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
  RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
`;

export async function createTestDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_PLATFORM);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
    try {
      await db.exec(sql.replace(UNAVAILABLE_EXTENSIONS, ''));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`, { cause: error });
    }
  }
  return db;
}
