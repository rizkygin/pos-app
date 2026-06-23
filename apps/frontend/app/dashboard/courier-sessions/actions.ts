import { API_URL } from '@/lib/api-url';

export async function goOnline() {
  const res = await fetch(`${API_URL}/api/courier/go-online`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to go online');
}

export async function goOffline() {
  const res = await fetch(`${API_URL}/api/courier/go-offline`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to go offline');
}
