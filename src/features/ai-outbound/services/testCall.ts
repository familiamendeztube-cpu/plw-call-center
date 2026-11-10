import { callStaffFunction } from '@/integrations/supabase/callStaffFunction';

export interface TestCallInput {
  phone: string;
  businessName: string;
  businessType: string;
  transferStaffId: string | null;
}

export interface TestCallResult {
  id: string;
  status: 'started';
  conversationId: string;
}

export async function startTestCall(input: TestCallInput): Promise<TestCallResult> {
  const payload = await callStaffFunction('ai-outbound-test-call', { ...input });
  if (typeof payload.id !== 'string' || typeof payload.conversationId !== 'string') {
    throw new Error('La respuesta del servidor no es válida. Intente de nuevo.');
  }
  return { id: payload.id, status: 'started', conversationId: payload.conversationId };
}
