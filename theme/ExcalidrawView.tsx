import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Sync local state with the native Fullscreen API so pressing Esc updates
  // the icon, and so we can fall back to CSS-fullscreen on browsers/contexts
  // where `requestFullscreen` is unavailable (e.g. iframes without allowfullscreen).
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen();
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        // Permissions denied or API blocked — fall through to CSS fallback.
      }
    }
    setIsFullscreen((v) => !v);
  }, []);

  // Pressing Esc while in CSS-fallback fullscreen should also exit.
  useEffect(() => {
    if (!isFullscreen || document.fullscreenElement) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const frame: React.CSSProperties = isFullscreen
    ? {
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'var(--rp-c-bg, #fff)',
      border: 'none',
      borderRadius: 0,
      margin: 0,
      overflow: 'hidden',
    }
    : {
      height,
      border: '1px solid var(--rp-c-divider, #e5e7eb)',
      borderRadius: 8,
      overflow: 'hidden',
      margin: '1.25rem 0',
      position: 'relative',
    };

  const buttonStyle: React.CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--rp-c-bg, #fff)',
    border: '1px solid var(--rp-c-divider, #e5e7eb)',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--rp-c-text-1, #333)',
    padding: 0,
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  };

  if (!Excalidraw) {
    return (
      <div
        ref={containerRef}
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
    <div ref={containerRef} style={{ ...frame, position: 'relative' }}>
      <button
        type="button"
        onClick={toggleFullscreen}
        style={buttonStyle}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {isFullscreen ? <ExitIcon /> : <EnterIcon />}
      </button>
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

function EnterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9V5a2 2 0 0 1 2-2h4" />
      <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
      <path d="M3 15v4a2 2 0 0 0 2 2h4" />
      <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3H5a2 2 0 0 0-2 2v4" />
      <path d="M15 3h4a2 2 0 0 1 2 2v4" />
      <path d="M9 21H5a2 2 0 0 1-2-2v-4" />
      <path d="M15 21h4a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}
