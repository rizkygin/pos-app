/**
 * Dine In / Take Away on a counter sale — mirrors SERVICE_TYPES in the
 * backend's db/schema.ts (orders.service_type, kitchen_tickets.service_type).
 *
 * A table's bill is always dine_in and the server sets that itself; the
 * cashier only ever chooses for a counter tab.
 */
export const SERVICE_TYPES = ['dine_in', 'take_away'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** What a new counter tab starts as: a counter sale is take away until said otherwise. */
export const DEFAULT_SERVICE_TYPE: ServiceType = 'take_away';

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  dine_in: 'Dine In',
  take_away: 'Take Away',
};

export const isServiceType = (v: unknown): v is ServiceType =>
  typeof v === 'string' && (SERVICE_TYPES as readonly string[]).includes(v);
