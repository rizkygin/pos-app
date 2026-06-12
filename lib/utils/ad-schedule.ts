import { getUTCTime } from '@/lib/timezone';

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function getCurrentAdSlot(timezone: string = 'Asia/Jakarta') {
  const now = getUTCTime(timezone);
  return {
    now,
    day: DAY_NAMES[now.getUTCDay()],
    hour: String(now.getUTCHours() + 1).padStart(2, '0'),
  };
}
