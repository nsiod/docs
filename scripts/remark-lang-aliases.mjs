import { visit } from 'unist-util-visit';

/**
 * Map code-block language tags that are not bundled in the default shiki
 * distribution to a renderable fallback, preserving the source text.
 *
 * Keeps the original language as a meta token so consumers that want to
 * introspect it still can.
 */
const ALIASES = {
  rego: 'text',
};

export default function remarkLangAliases() {
  return (tree) => {
    visit(tree, 'code', (node) => {
      if (typeof node.lang !== 'string') return;
      const mapped = ALIASES[node.lang];
      if (!mapped) return;
      node.meta = node.meta ? `${node.meta} lang=${node.lang}` : `lang=${node.lang}`;
      node.lang = mapped;
    });
  };
}
