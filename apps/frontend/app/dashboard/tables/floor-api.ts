import { API_URL } from '@/lib/api-url';

export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data: T & { success?: boolean; error?: string; code?: string };
  /** A sentence to show the host when !ok. */
  error: string;
};

/**
 * One call to the table management API. Never throws: a network failure comes
 * back as ok=false with a message, so every button on the floor can report
 * what happened in one line instead of each growing its own try/catch.
 */
export async function floorApi<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const error =
      (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
      (res.ok ? '' : `Gagal (${res.status})`);
    return { ok: res.ok && data?.success !== false, status: res.status, data, error };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: {} as ApiResult<T>['data'],
      error: e instanceof TypeError ? 'Tidak bisa terhubung ke server.' : String(e),
    };
  }
}

/** The viewer's own timezone, for "today" on the server. */
export const viewerTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
  } catch {
    return 'Asia/Jakarta';
  }
};
