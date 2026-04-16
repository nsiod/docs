import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Github } from 'lucide-react';
import { Sidebar } from '@/shared/components/layout/Sidebar';
import { ThemeToggle } from '@/shared/components/layout/ThemeToggle';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold tracking-tight">NSIO Docs</span>
          <span className="text-[11px] text-muted-foreground">
            生态总览 · 11 模块 · 三层叙事
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            href="https://github.com"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub"
          >
            <Github className="h-3.5 w-3.5" />
          </a>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-72 shrink-0 md:block">
          <Sidebar />
        </div>
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
