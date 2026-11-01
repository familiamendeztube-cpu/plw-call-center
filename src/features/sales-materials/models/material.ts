export type MaterialKind =
  'presentation' | 'video' | 'demonstration' | 'email_template' | 'pricing';

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  presentation: 'Presentación PDF',
  video: 'Video',
  demonstration: 'Demostración',
  email_template: 'Plantilla de correo',
  pricing: 'Precios y servicios',
};

export type MaterialApproval = 'approved' | 'awaiting_configuration';

export interface SalesMaterial {
  id: string;
  title: string;
  description: string;
  kind: MaterialKind;
  approval: MaterialApproval;
  url: string | null;
  updatedAt: string;
}
