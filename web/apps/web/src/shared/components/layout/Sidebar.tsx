import { LAYER_GROUPS, LAYER_LABELS } from '@shared/index';
import { Link, useLocation } from '@tanstack/react-router';
import { getAllModules } from '@/features/content/content';
import { cn } from '@/shared/lib/utils';

export function Sidebar() {
  const location = useLocation();
  const modules = getAllModules();

  const path = location.pathname;

  return (
    <aside className="h-full w-full overflow-y-auto border-r bg-sidebar text-sidebar-foreground">
      <nav className="p-3">
        <div className="mb-3">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              path === '/'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            首页 · 生态总览
          </Link>
        </div>

        {LAYER_GROUPS.map((group) => {
          const items = modules.filter((m) => m.layer === group.layer);
          if (items.length === 0)
            return null;
          return (
            <div key={group.layer} className="mb-4">
              <div className="mb-1 flex items-baseline gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>{group.heading}</span>
                <span className="font-mono">{group.range}</span>
              </div>
              <ul className="space-y-1">
                {items.map((m) => {
                  const href = `/modules/${m.id}`;
                  const isActive = path === href || path.startsWith(`${href}/`);
                  return (
                    <li key={m.id}>
                      <Link
                        to="/modules/$moduleId"
                        params={{ moduleId: m.id }}
                        className={cn(
                          'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                            : 'hover:bg-sidebar-accent/60',
                        )}
                        title={m.title}
                      >
                        <span className="font-mono text-[11px] text-muted-foreground mr-1.5">
                          {m.id.slice(0, 2)}
                        </span>
                        {m.title.replace(/^\d+\s*[·.]\s*/, '')}
                      </Link>
                      {isActive && m.docs.length > 1 && (
                        <ul className="ml-5 mt-1 border-l pl-3 space-y-0.5">
                          {m.docs.map((d) => (
                            <li key={d.slug}>
                              <a
                                href={
                                  d.slug === 'readme'
                                    ? `#top`
                                    : `#doc-${d.slug}`
                                }
                                className="block rounded px-2 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground"
                              >
                                {d.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div className="mt-6 rounded-md border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <div className="font-semibold mb-1 text-foreground">三层叙事</div>
          <div>
            <b>{LAYER_LABELS.describe}</b> · 现状结构（01-09）
          </div>
          <div>
            <b>{LAYER_LABELS.critique}</b> · 反向审查（10）
          </div>
          <div>
            <b>{LAYER_LABELS.vision}</b> · 生产级愿景（11）
          </div>
        </div>
      </nav>
    </aside>
  );
}
