// Types and constants shared by client and server. Deliberately free of any
// server-only import so client components can use it without dragging
// SERVER_API_URL into the browser bundle — the fetching lives in
// lib/maintenance-server.ts.

export type MaintenanceStatus = 'off' | 'upcoming' | 'active';

export type Maintenance = {
  status: MaintenanceStatus;
  startsAt: string | null;
  endsAt: string | null;
  message: string | null;
};

export const MAINTENANCE_OFF: Maintenance = {
  status: 'off',
  startsAt: null,
  endsAt: null,
  message: null,
};

export const DEFAULT_MAINTENANCE_MESSAGE =
  'Kami sedang melakukan pemeliharaan sistem agar Ulun Pesan berjalan lebih baik.';
