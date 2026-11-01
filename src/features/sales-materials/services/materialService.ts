import type { SalesMaterial } from '@/features/sales-materials/models/material';

export interface MaterialService {
  listMaterials(): Promise<SalesMaterial[]>;
}
