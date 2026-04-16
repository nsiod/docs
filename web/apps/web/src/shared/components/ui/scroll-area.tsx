import { ScrollArea as BaseScrollArea } from '@base-ui-components/react/scroll-area';
import { forwardRef } from 'react';
import { cn } from '@/shared/lib/utils';

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof BaseScrollArea.Root> {
  readonly viewportClassName?: string;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, viewportClassName, children, ...rest }, ref) => (
    <BaseScrollArea.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...rest}
    >
      <BaseScrollArea.Viewport
        className={cn('h-full w-full rounded-[inherit] outline-none', viewportClassName)}
      >
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none rounded-full p-[1px] opacity-0 transition-opacity data-[hovering]:opacity-100 data-[scrolling]:opacity-100"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className="flex h-2 touch-none select-none rounded-full p-[1px] opacity-0 transition-opacity data-[hovering]:opacity-100 data-[scrolling]:opacity-100"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  ),
);
ScrollArea.displayName = 'ScrollArea';
