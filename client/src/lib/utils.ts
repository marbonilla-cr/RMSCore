import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const formatCurrency = (amount: number | string): string => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '\u20a10';
  return `\u20a1${n.toLocaleString('es-CR')}`;
};

export const timeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

export const getStatusColor = (status: string): string => ({
  OPEN:       'var(--green)',
  IN_KITCHEN: 'var(--blue)',
  PREPARING:  'var(--amber)',
  READY:      'var(--green)',
  PAID:       'var(--text3)',
  CANCELLED:  'var(--red)',
  VOID:       'var(--red)',
} as Record<string, string>)[status] ?? 'var(--text3)';

export const getStatusLabel = (status: string): string => ({
  OPEN:       'Abierta',
  IN_KITCHEN: 'En Cocina',
  PREPARING:  'Preparando',
  READY:      'Lista',
  PAID:       'Pagada',
  CANCELLED:  'Cancelada',
  VOID:       'Anulada',
} as Record<string, string>)[status] ?? status;

export const getStatusBadgeClass = (status: string): string => ({
  OPEN:       'badge-green',
  IN_KITCHEN: 'badge-blue',
  PREPARING:  'badge-amber',
  READY:      'badge-green',
  PAID:       'badge-muted',
  CANCELLED:  'badge-red',
  VOID:       'badge-red',
} as Record<string, string>)[status] ?? 'badge-muted';
