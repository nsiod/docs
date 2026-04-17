import { LAYER_GROUPS } from '@shared/index';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { getAllModules } from '@/features/content/content';
import { Mermaid } from '@/features/diagram/Mermaid';
import { buildOverviewChart, OVERVIEW_STATS } from '@/features/ecosystem/graph-data';
import { ScrollArea } from '@/shared/components/ui/scroll-area';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const modules = getAllModules();

  return (
    <ScrollArea className="h-full" viewportClassName="px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            NSIO Ecosystem Overview
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            四组件架构 · NSD + NSGW + NSN + NSC
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            NSIO 是 Rust 12 crate 构成的零信任接入生态。NSD 下发配置、NSGW 中继
            WireGuard/WSS 隧道、NSN 承载站点数据面、NSC 提供用户侧虚 IP+DNS。点击节点
            可跳转到对应模块文档。
          </p>
        </section>

        <section>
          <Mermaid chart={buildOverviewChart(import.meta.env.BASE_URL ?? '/')} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{OVERVIEW_STATS.nodes}</span> 节点 ·
            <span className="font-mono ml-1">{OVERVIEW_STATS.edges}</span> 边 ·
            点击节点跳转模块文档
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">模块索引</h2>
          {LAYER_GROUPS.map((group) => {
            const items = modules.filter((m) => m.layer === group.layer);
            if (items.length === 0)
              return null;
            return (
              <div key={group.layer} className="space-y-2">
                <div className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>{group.heading}</span>
                  <span className="font-mono">{group.range}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((m) => (
                    <Link
                      key={m.id}
                      to="/modules/$moduleId"
                      params={{ moduleId: m.id }}
                      className="group flex flex-col rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
                    >
                      <div className="flex items-baseline justify-between">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {m.id}
                        </div>
                        <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <div className="mt-1 text-sm font-medium">
                        {m.title.replace(/^\d+\s*[·.]\s*/, '')}
                      </div>
                      <p className="mt-1 line-clamp-3 text-[12px] text-muted-foreground">
                        {m.summary}
                      </p>
                      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>
                          <span className="font-mono">{m.docs.length}</span> docs
                        </span>
                        <span>
                          <span className="font-mono">{m.diagrams.length}</span> mmd
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </ScrollArea>
  );
}
