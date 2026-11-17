import type { MaterialKind, SalesMaterial } from '@/features/sales-materials/models/material';

export interface MaterialInput {
  /** Null adds a new material. */
  id: string | null;
  title: string;
  description: string;
  kind: MaterialKind;
  /** Must start with https://. Agents open it and send it to customers. */
  url: string;
  approved: boolean;
}

export interface MaterialService {
  listMaterials(): Promise<SalesMaterial[]>;
  /** Administrators only. */
  saveMaterial(input: MaterialInput): Promise<void>;
  deleteMaterial(materialId: string): Promise<void>;
}
