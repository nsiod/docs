import type { ModuleEntry } from '@/features/content/content';
import { FileText, Layers, Network } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Mermaid } from '@/features/diagram/Mermaid';
import { ReactFlowDiagram } from '@/features/diagram/ReactFlowDiagram';
import { getModuleFlow } from '@/features/ecosystem/graph-data';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ModuleViewerProps {
  readonly module: ModuleEntry;
}

export function ModuleViewer({ module }: ModuleViewerProps) {
  const firstDocSlug = module.docs[0]?.slug ?? 'readme';
  const [active, setActive] = useState<string>(firstDocSlug);

  const flow = useMemo(() => getModuleFlow(module.id), [module.id]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-muted-foreground">{module.id}</span>
          <h1 className="text-xl font-semibold tracking-tight">{module.title}</h1>
        </div>
        {module.summary && (
          <p className="mt-1.5 max-w-3xl text-[13px] text-muted-foreground">{module.summary}</p>
        )}
      </header>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" viewportClassName="px-6 py-6">
          <div id="top" className="space-y-8">
            {flow && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Network className="h-3.5 w-3.5" />
                  <span>Adjacency · ReactFlow</span>
                </div>
                <ReactFlowDiagram nodes={flow.nodes} edges={flow.edges} height={460} />
              </section>
            )}

            {module.docs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Documents</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {module.docs.length}
                  </span>
                </div>
                <Tabs value={active} onValueChange={(v) => setActive(String(v ?? ''))}>
                  <TabsList>
                    {module.docs.map((d) => (
                      <TabsTrigger key={d.slug} value={d.slug}>
                        {d.slug === 'readme' ? 'README' : d.title}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {module.docs.map((d) => (
                    <TabsContent key={d.slug} value={d.slug}>
                      <article
                        id={d.slug === 'readme' ? 'readme' : `doc-${d.slug}`}
                        className="scroll-mt-4"
                      >
                        <MarkdownRenderer source={d.content} moduleId={module.id} />
                      </article>
                    </TabsContent>
                  ))}
                </Tabs>
              </section>
            )}

            {module.diagrams.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Mermaid Diagrams</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {module.diagrams.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {module.diagrams.map((diag) => (
                    <div key={diag.slug} id={`diagram-${diag.slug}`}>
                      <Mermaid chart={diag.source} title={diag.filename} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
