export const VOID_REASON_CODES = [
  "KITCHEN_MISTAKE",
  "WAITER_MISTAKE",
  "CUSTOMER_CANCELLED",
  "ITEM_UNAVAILABLE",
  "DUPLICATE",
  "QUALITY_ISSUE",
  "COMPED",
  "OTHER",
] as const;

export type VoidReasonCode = typeof VOID_REASON_CODES[number];

export const VOID_REASONS: { code: VoidReasonCode; label: string }[] = [
  { code: "KITCHEN_MISTAKE", label: "Error de cocina" },
  { code: "WAITER_MISTAKE", label: "Error de mesero" },
  { code: "CUSTOMER_CANCELLED", label: "Cliente canceló" },
  { code: "ITEM_UNAVAILABLE", label: "Producto no disponible" },
  { code: "DUPLICATE", label: "Duplicado" },
  { code: "QUALITY_ISSUE", label: "Problema de calidad" },
  { code: "COMPED", label: "Cortesía" },
  { code: "OTHER", label: "Otro (especificar)" },
];
