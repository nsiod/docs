import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import { forwardRef } from 'react';
import { cn } from '@/shared/lib/utils';

type RootProps = React.ComponentPropsWithoutRef<typeof BaseTabs.Root>;
type ListProps = React.ComponentPropsWithoutRef<typeof BaseTabs.List>;
type TabProps = React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>;
type PanelProps = React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>;

export const Tabs = forwardRef<HTMLDivElement, RootProps>(({ className, ...rest }, ref) => (
  <BaseTabs.Root ref={ref} className={cn('flex flex-col gap-3', className)} {...rest} />
));
Tabs.displayName = 'Tabs';

export const TabsList = forwardRef<HTMLDivElement, ListProps>(({ className, ...rest }, ref) => (
  <BaseTabs.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center gap-1 rounded-md bg-muted/40 p-1 text-muted-foreground flex-wrap',
      className,
    )}
    {...rest}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<HTMLButtonElement, TabProps>(
  ({ className, ...rest }, ref) => (
    <BaseTabs.Tab
      ref={ref}
      className={cn(
        'inline-flex h-7 items-center justify-center whitespace-nowrap rounded px-3 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm',
        'hover:text-foreground',
        className,
      )}
      {...rest}
    />
  ),
);
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, ...rest }, ref) => (
    <BaseTabs.Panel
      ref={ref}
      className={cn(
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md',
        className,
      )}
      {...rest}
    />
  ),
);
TabsContent.displayName = 'TabsContent';
