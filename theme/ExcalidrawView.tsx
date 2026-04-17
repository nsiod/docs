import { useEffect, useState } from 'react';

/**
 * Client-only Excalidraw viewer.
 *
 * Lazy-loads `@excalidraw/excalidraw` so the ~2MB bundle only ships on pages
 * that actually use it and only during CSR — the SSG pass renders a placeholder.
 * Once fetched, the browser caches the chunk across page navigations.
 *
 * Usage from MDX:
 *   import data from './diagrams/foo.excalidraw.json';
 *   <ExcalidrawView data={data} />
 */
interface ExcalidrawScene {
  elements?: unknown[];
  appState?: { viewBackgroundColor?: string };
  files?: Record<string, unknown>;
}

interface Props {
  data: ExcalidrawScene;
  height?: number | string;
}

export function ExcalidrawView({ data, height = 520 }: Props) {
  // Using `any` is unavoidable here because `Excalidraw` is a forward-ref
  // component whose type comes from the dynamically imported module.
  const [Excalidraw, setExcalidraw] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [mod] = await Promise.all([
        import('@excalidraw/excalidraw'),
        // Side-effect CSS import — Excalidraw ships its own styles.
        import('@excalidraw/excalidraw/index.css'),
      ]);
      if (mounted) setExcalidraw(() => mod.Excalidraw);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const frame: React.CSSProperties = {
    height,
    border: '1px solid var(--rp-c-divider, #e5e7eb)',
    borderRadius: 8,
    overflow: 'hidden',
    margin: '1.25rem 0',
  };

  if (!Excalidraw) {
    return (
      <div
        style={{
          ...frame,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--rp-c-text-2, #888)',
          fontSize: 14,
        }}
      >
        Loading Excalidraw…
      </div>
    );
  }

  return (
    <div style={frame}>
      <Excalidraw
        initialData={{
          elements: data.elements ?? [],
          appState: {
            viewBackgroundColor: data.appState?.viewBackgroundColor ?? '#ffffff',
          },
          files: data.files ?? null,
          scrollToContent: true,
        }}
        viewModeEnabled
        zenModeEnabled
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
            clearCanvas: false,
            changeViewBackgroundColor: false,
            toggleTheme: true,
          },
        }}
      />
    </div>
  );
}
