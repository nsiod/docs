import { Link } from '@tanstack/react-router';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { Mermaid } from '@/features/diagram/Mermaid';
import 'highlight.js/styles/github.css';

interface RewriteResult {
  readonly internal: boolean;
  readonly href: string;
  readonly moduleId?: string;
}

function rewriteHref(raw: string, currentModuleId: string): RewriteResult {
  if (!raw)
    return { internal: false, href: raw };
  if (raw.startsWith('#') || raw.startsWith('mailto:') || /^[a-z]+:\/\//i.test(raw)) {
    return { internal: false, href: raw };
  }
  const [pathPart = '', hash = ''] = raw.split('#');
  const base = `/docs/${currentModuleId}/`;
  let resolved: URL;
  try {
    resolved = new URL(pathPart, `http://__nsio__${base}`);
  }
  catch {
    return { internal: false, href: raw };
  }
  const match = resolved.pathname.match(/^\/docs\/([^/]+)(?:\/(.*))?$/);
  if (!match || !match[1])
    return { internal: false, href: raw };
  const mod = match[1];
  const rest = match[2] ?? '';
  if (!rest || rest === 'README.md' || rest === '') {
    return {
      internal: true,
      moduleId: mod,
      href: `/modules/${mod}${hash ? `#${hash}` : ''}`,
    };
  }
  if (rest.endsWith('.md')) {
    const slug = rest.replace(/\.md$/, '').toLowerCase();
    return {
      internal: true,
      moduleId: mod,
      href: `/modules/${mod}#doc-${slug}`,
    };
  }
  if (rest.startsWith('diagrams/')) {
    return {
      internal: true,
      moduleId: mod,
      href: `/modules/${mod}${hash ? `#${hash}` : ''}`,
    };
  }
  return { internal: true, moduleId: mod, href: `/modules/${mod}` };
}

interface MarkdownRendererProps {
  readonly source: string;
  readonly moduleId: string;
}

export function MarkdownRenderer({ source, moduleId }: MarkdownRendererProps) {
  const components: Components = {
    a: ({ href, children, ...rest }) => {
      if (!href)
        return <span {...rest}>{children}</span>;
      const r = rewriteHref(href, moduleId);
      if (r.internal && r.moduleId) {
        return (
          <Link
            to="/modules/$moduleId"
            params={{ moduleId: r.moduleId }}
            hash={r.href.includes('#') ? r.href.split('#')[1] : undefined}
          >
            {children}
          </Link>
        );
      }
      if (r.href.startsWith('http')) {
        return (
          <a href={r.href} target="_blank" rel="noreferrer noopener" {...rest}>
            {children}
          </a>
        );
      }
      return (
        <a href={r.href} {...rest}>
          {children}
        </a>
      );
    },
    code: ({ className, children, ...rest }) => {
      const lang = /language-(\w+)/.exec(className ?? '')?.[1];
      if (lang === 'mermaid') {
        const chart = String(children).replace(/\n$/, '');
        return <Mermaid chart={chart} />;
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className="prose-doc max-w-none text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, rehypeHighlight]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
