import { createFileRoute, notFound } from '@tanstack/react-router';
import { getModule } from '@/features/content/content';
import { ModuleViewer } from '@/features/module-viewer/ModuleViewer';

export const Route = createFileRoute('/modules/$moduleId')({
  component: ModulePage,
  loader: ({ params }) => {
    const mod = getModule(params.moduleId);
    if (!mod)
      throw notFound();
    return { module: mod };
  },
  notFoundComponent: () => (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      Module not found.
    </div>
  ),
});

function ModulePage() {
  const { module } = Route.useLoaderData();
  return <ModuleViewer module={module} />;
}
