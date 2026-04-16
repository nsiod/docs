import { findDiagram } from '@/features/content/content';
import { Mermaid } from './Mermaid';

interface MermaidFileProps {
  readonly moduleId: string;
  readonly slug: string;
  readonly title?: string;
}

export function MermaidFile({ moduleId, slug, title }: MermaidFileProps) {
  const file = findDiagram(moduleId, slug);
  if (!file) {
    return (
      <div className="my-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
        missing .mmd: {moduleId}/diagrams/{slug}.mmd
      </div>
    );
  }
  return <Mermaid chart={file.source} title={title ?? file.filename} />;
}
