import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTheme } from '@/shared/hooks/use-theme';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
    },
  },
});

function ThemeProvider({ children }: { readonly children: React.ReactNode }) {
  const { theme } = useTheme();
  useEffect(() => {
    // touch theme to ensure class is in sync on mount
    void theme;
  }, [theme]);
  return children;
}

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
