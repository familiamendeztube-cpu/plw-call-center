import {
  callStaffFunction,
  INVALID_RESPONSE,
  isRecord,
} from '@/integrations/supabase/callStaffFunction';

export interface AgentSipAccount {
  staffId: string;
  wssUrl: string;
  sipDomain: string;
  username: string;
}

export interface AgentSipAccountInput extends AgentSipAccount {
  password: string;
}

function parseAccounts(payload: Record<string, unknown>): AgentSipAccount[] | null {
  if (!Array.isArray(payload.accounts)) return null;
  const accounts: AgentSipAccount[] = [];
  for (const row of payload.accounts) {
    if (
      !isRecord(row) ||
      typeof row.staffId !== 'string' ||
      typeof row.wssUrl !== 'string' ||
      typeof row.sipDomain !== 'string' ||
      typeof row.username !== 'string'
    ) {
      return null;
    }
    accounts.push({
      staffId: row.staffId,
      wssUrl: row.wssUrl,
      sipDomain: row.sipDomain,
      username: row.username,
    });
  }
  return accounts;
}

export async function listAgentSipAccounts(): Promise<AgentSipAccount[]> {
  const accounts = parseAccounts(await callStaffFunction('telephony', { action: 'list_accounts' }));
  if (!accounts) throw new Error(INVALID_RESPONSE);
  return accounts;
}

export async function saveAgentSipAccount(input: AgentSipAccountInput): Promise<void> {
  await callStaffFunction('telephony', { action: 'set_account', ...input });
}
