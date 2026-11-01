import type { AppServices } from '@/app/appServices';
import { createPendingEmailConnector } from '@/integrations/email/pendingEmailConnector';
import { createPendingTelephonyConnector } from '@/integrations/telephony/pendingTelephonyConnector';
import { createProductionAssignmentService } from '@/production/adapters/productionAssignmentService';
import { createProductionAuthService } from '@/production/adapters/productionAuthService';
import {
  createProductionAgentDirectory,
  createProductionPresenceService,
} from '@/production/adapters/productionDirectoryAndPresence';
import {
  createProductionFollowupService,
  createProductionMaterialService,
} from '@/production/adapters/productionFollowupService';
import { createProductionInboxService } from '@/production/adapters/productionInboxService';
import { createProductionLeadService } from '@/production/adapters/productionLeadService';

export function createProductionServices(): AppServices {
  return {
    auth: createProductionAuthService(),
    agents: createProductionAgentDirectory(),
    presence: createProductionPresenceService(),
    inbox: createProductionInboxService(),
    leads: createProductionLeadService(),
    followups: createProductionFollowupService(),
    materials: createProductionMaterialService(),
    assignments: createProductionAssignmentService(),
    email: createPendingEmailConnector(),
    telephony: createPendingTelephonyConnector(),
  };
}
