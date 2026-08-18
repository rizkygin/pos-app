'use client';

import { useEffect, useState } from 'react';

/**
 * Renders a timestamp in the VIEWER's timezone.
 *
 * Server components have no viewer timezone to work with: formatting there uses
 * the container's TZ, which is unset in the deployed image and therefore UTC —
 * so every server-rendered time came out 7 hours early for a WIB reader. The
 * format has to happen in the browser.
 *
 * The formatting runs in an effect rather than during render so server and first
 * client pass agree (both empty); anything else is a hydration mismatch, and
 * suppressing that would just keep the wrong server text on screen.
 */
export function LocalDateTime({
  value,
  options = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  locale = 'id-ID',
}: {
  value: string | number | Date;
  options?: Intl.DateTimeFormatOptions;
  locale?: string;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    const d = new Date(value);
    if (!isNaN(d.getTime())) setText(d.toLocaleDateString(locale, options));
    // options is an inline object literal at every call site; stringify it so a
    // fresh-but-equal object does not re-run this on every render.
  }, [value, locale, JSON.stringify(options)]);

  return <>{text}</>;
}
