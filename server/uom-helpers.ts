export const ALLOWED_UOMS = ['KG', 'G', 'L', 'ML', 'UNIT', 'PORTION'] as const;
export type AllowedUom = (typeof ALLOWED_UOMS)[number];

const ALIAS_MAP: Record<string, AllowedUom> = {
  KG: 'KG', KILO: 'KG', KILOS: 'KG', KGS: 'KG',
  G: 'G', GR: 'G', GRAMOS: 'G', GRAMO: 'G',
  L: 'L', LITRO: 'L', LITROS: 'L', LT: 'L',
  ML: 'ML', MILILITRO: 'ML', MILILITROS: 'ML',
  UNIT: 'UNIT', UNITS: 'UNIT', UNIDAD: 'UNIT', UNIDADES: 'UNIT', UN: 'UNIT', UND: 'UNIT',
  PORTION: 'PORTION', PORCION: 'PORTION', 'PORCIÓN': 'PORTION', PRC: 'PORTION',
};

export function normalizeUom(raw: string): AllowedUom {
  const key = raw.trim().toUpperCase();
  const mapped = ALIAS_MAP[key];
  if (mapped) return mapped;
  if ((ALLOWED_UOMS as readonly string[]).includes(key)) return key as AllowedUom;
  throw new Error(`UOM no reconocida: ${raw}`);
}

export function toSmallUnit(qty: number, baseUom: AllowedUom): { qty: number; smallUom: string } {
  switch (baseUom) {
    case 'KG': return { qty: qty * 1000, smallUom: 'G' };
    case 'L': return { qty: qty * 1000, smallUom: 'ML' };
    default: return { qty, smallUom: baseUom };
  }
}

export function getCalcBasisLabel(baseUom: string): string {
  const labels: Record<string, string> = {
    KG: 'por 1 KG',
    G: 'por 1 g',
    L: 'por 1 L',
    ML: 'por 1 ml',
    UNIT: 'por 1 unidad',
    PORTION: 'por 1 porción',
  };
  return labels[baseUom] || `por 1 ${baseUom}`;
}
