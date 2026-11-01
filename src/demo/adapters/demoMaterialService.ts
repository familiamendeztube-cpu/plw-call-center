import type { MaterialService } from '@/features/sales-materials/services/materialService';
import type { DemoState } from '@/demo/demoState';
import { simulateLatency } from '@/demo/demoIds';

export function createDemoMaterialService(state: DemoState): MaterialService {
  return {
    async listMaterials() {
      await simulateLatency(120);
      return state.materials.map((material) => ({ ...material }));
    },
  };
}
