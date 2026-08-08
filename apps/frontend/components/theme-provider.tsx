'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

// React context can't cross the Server Component boundary, so next-themes gets
// wrapped in a Client Component that the root layout renders around children.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
