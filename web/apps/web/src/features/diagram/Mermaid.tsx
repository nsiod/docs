import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '@/shared/hooks/use-theme';

interface MermaidProps {
  readonly chart: string;
  readonly title?: string;
}

export function Mermaid({ chart, title }: MermaidProps) {
  const ref = useRef<HTMLDivElement>(null);
  const genId = useId();
  const idRef = useRef(`mmd-${genId.replace(/[^a-z0-9]/gi, '')}-${Math.random().toString(36).slice(2, 7)}`);
  const [err, setErr] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(idRef.current, chart);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setErr(null);
        }
      }
      catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (!cancelled)
          setErr(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, resolvedTheme]);

  return (
    <div className="my-4 rounded-md border bg-card p-3 overflow-x-auto">
      {title && (
        <div className="text-xs font-semibold text-muted-foreground mb-2">{title}</div>
      )}
      {err ? (
        <pre className="text-xs text-destructive whitespace-pre-wrap">
          Mermaid error: {err}
        </pre>
      ) : (
        <div ref={ref} className="[&_svg]:max-w-full [&_svg]:h-auto" />
      )}
    </div>
  );
}
