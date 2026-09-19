import { SERVICE_TYPES, type ServiceType } from '../db/schema';

/**
 * Dine In / Take Away, from untrusted input. Anything unrecognised is null —
 * "not recorded" — and never a guess: an old client that sends nothing must
 * not have its sales filed as take away (or dine in) on its behalf.
 *
 * A table's bill ignores this altogether; it is always dine_in, decided by the
 * server from the table link (see add-order-detail and insertKitchenTicket).
 */
export function parseServiceType(v: unknown): ServiceType | null {
  return typeof v === 'string' && (SERVICE_TYPES as readonly string[]).includes(v)
    ? (v as ServiceType)
    : null;
}

/**
 * What a COUNTER sale or counter kitchen ticket records. An outlet whose owner
 * turned the switch off records nothing, whatever a till still running the old
 * page sends — the setting, not the client, decides.
 */
export function counterServiceType(
  outlet: { service_type_enabled: boolean },
  v: unknown,
): ServiceType | null {
  return outlet.service_type_enabled ? parseServiceType(v) : null;
}
