interface SourceRefProps {
  readonly path: string;
}

const SOURCE_PATTERN = /^crates\/[^\s:]+\.rs(?::\d+(?:-\d+)?)?$/;

export function SourceRef({ path }: SourceRefProps) {
  const looksLikeSource = SOURCE_PATTERN.test(path);
  return (
    <code
      className="px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono text-[0.85em]"
      data-source-ref={looksLikeSource || undefined}
      title={looksLikeSource ? 'crate source reference (not clickable)' : undefined}
    >
      {path}
    </code>
  );
}
