import type { MaterialService } from '@/features/sales-materials/services/materialService';
import type { DemoState } from '@/demo/demoState';
import { createDemoId, simulateLatency } from '@/demo/demoIds';

export function createDemoMaterialService(state: DemoState): MaterialService {
  return {
    async listMaterials() {
      await simulateLatency(120);
      return state.materials.map((material) => ({ ...material }));
    },
    async saveMaterial(input) {
      await simulateLatency(120);
      const saved = {
        id: input.id ?? createDemoId('material'),
        title: input.title,
        description: input.description,
        kind: input.kind,
        approval: input.approved ? ('approved' as const) : ('awaiting_configuration' as const),
        url: input.url || null,
        updatedAt: new Date().toISOString(),
      };
      state.materials = [...state.materials.filter((item) => item.id !== saved.id), saved];
    },
    async deleteMaterial(materialId) {
      await simulateLatency(120);
      state.materials = state.materials.filter((item) => item.id !== materialId);
    },
  };
}
