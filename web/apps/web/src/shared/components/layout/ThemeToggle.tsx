import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/shared/hooks/use-theme';
import { cn } from '@/shared/lib/utils';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: { value: 'light' | 'dark' | 'system'; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ];
  return (
    <div className="inline-flex items-center rounded-md border bg-background p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          aria-label={`${opt.label} theme`}
          aria-pressed={theme === opt.value}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded',
            theme === opt.value
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <opt.icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
