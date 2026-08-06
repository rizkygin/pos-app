import { API_URL } from '@/lib/api-url';
import { notifyShiftEnded, notifyShiftStarted } from '@/lib/native-bridge';

export async function goOnline() {
  const res = await fetch(`${API_URL}/api/courier/go-online`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to go online');
  // After the request succeeds, not before: telling the app to start tracking
  // ahead of a go-online that then fails would run the foreground service for
  // a courier who — as far as the backend is concerned — never went on shift.
  notifyShiftStarted();
}

export async function goOffline() {
  const res = await fetch(`${API_URL}/api/courier/go-offline`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    // The backend refuses this while an order is in flight and says why; a
    // generic message would leave the courier tapping a button that keeps
    // failing with no reason given.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'Gagal offline');
  }
  notifyShiftEnded();
}
