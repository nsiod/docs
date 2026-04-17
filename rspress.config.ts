import path from 'node:path';
import { defineConfig } from 'rspress/config';
import { pluginShiki } from '@rspress/plugin-shiki';
import mermaid from 'rspress-plugin-mermaid';
import remarkLangAliases from './scripts/remark-lang-aliases.mjs';
import remarkMmdInclude from './scripts/remark-mmd-include.mjs';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  base: '/docs/',
  title: 'NSIO Architecture',
  description: 'NSIO ecosystem architecture documentation — NSD + NSGW + NSN + NSC.',
  outDir: 'doc_build',
  logoText: 'NSIO Docs',
  markdown: {
    // mdxRs must be disabled so JS-side remark plugins are honored.
    mdxRs: false,
    remarkPlugins: [remarkLangAliases, remarkMmdInclude],
  },
  plugins: [
    mermaid(),
    pluginShiki({
      langs: ['bash', 'hcl', 'json', 'jsonc', 'markdown', 'rust', 'text', 'toml', 'ts', 'typescript', 'yaml'],
    }),
  ],
  themeConfig: {
    footer: {
      message: 'NSIO Architecture Docs · MIT License',
    },
    hideNavbar: 'auto',
    // Content animation intercepts layout during route transitions and, combined
    // with TOC anchor jumps, causes the page to over-scroll past the target. Off.
    enableContentAnimation: false,
    enableScrollToTop: true,
    lastUpdated: true,
    outlineTitle: 'On this page',
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/nsiod/docs',
      },
    ],
  },
  globalStyles: path.join(__dirname, 'theme/styles.css'),
});
