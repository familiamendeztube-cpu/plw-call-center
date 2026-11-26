import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  UsDialerCard,
  type UsCall,
  type UsCallback,
  type UsLead,
  type UsRuntime,
  type UsSmsMessage,
} from '@/features/ai-outbound/components/UsDialerCard';

/** The AI dialer calls the US only (owner, 2026-11-26); Costa Rica is inbound-only. */
export function AdminAiOutboundPage() {
  const [runtime, setRuntime] = useState<UsRuntime | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [calls, setCalls] = useState<UsCall[]>([]);
  const [leads, setLeads] = useState<UsLead[]>([]);
  const [callbacks, setCallbacks] = useState<UsCallback[]>([]);
  const [sms, setSms] = useState<UsSmsMessage[]>([]);

  const reload = () => {
    const supabase = getSupabaseClient();
    void Promise.all([
      supabase.from('us_dialer_runtime').select('scheduler_ready,paused,last_tick_at,last_error,provider_agent_id,config_verified_at,transfer_uri,caller_e164,dialed_today,daily_cap,max_lines,allowed_from,allowed_to').eq('id', 1).maybeSingle(),
      supabase.from('us_calls').select('id,created_at,phone,state,outcome,summary,error,is_test,lead:us_leads(business_name)').order('created_at', { ascending: false }).limit(10),
      supabase.from('us_leads').select('id,raw_phone,phone_e164,dest,contact_name,business_name,business_type,timezone,consent_ref,sms_mobile,sms_consent,excluded_reason,last_call_at,created_at').order('created_at', { ascending: true }).limit(500),
      supabase.from('us_callbacks').select('id,phone,scheduled_for,timezone,status,fail_reason,lead:us_leads(business_name)').order('scheduled_for', { ascending: true }).limit(20),
      supabase.from('us_sms_messages').select('id,lead_id,to_e164,body,web_url,secretary_url,status,created_at').order('created_at', { ascending: false }).limit(20),
    ]).then(([runtimeRow, callRows, leadRows, callbackRows, smsRows]) => {
      setRuntimeError(runtimeRow.error ? 'No se pudo leer el estado del marcador de EE. UU.' : null);
      setRuntime((runtimeRow.data as UsRuntime | null) ?? null);
      setCalls(callRows.error ? [] : ((callRows.data ?? []) as unknown as UsCall[]));
      setLeads(leadRows.error ? [] : ((leadRows.data ?? []) as unknown as UsLead[]));
      setCallbacks(callbackRows.error ? [] : ((callbackRows.data ?? []) as unknown as UsCallback[]));
      setSms(smsRows.error ? [] : ((smsRows.data ?? []) as unknown as UsSmsMessage[]));
    });
  };

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Marcador IA"
        description="Anna llama a negocios de EE. UU. con la línea de EE. UU. Costa Rica solo recibe llamadas."
      />
      <UsDialerCard
        runtime={runtime}
        runtimeError={runtimeError}
        calls={calls}
        leads={leads}
        callbacks={callbacks}
        smsMessages={sms}
        onChanged={reload}
      />
    </div>
  );
}
