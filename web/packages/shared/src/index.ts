export type ModuleLayer = 'describe' | 'critique' | 'vision';

export interface ModuleMeta {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly layer: ModuleLayer;
}

export interface DocMeta {
  readonly slug: string;
  readonly filename: string;
  readonly title: string;
}

export interface DiagramMeta {
  readonly slug: string;
  readonly filename: string;
}

export const LAYER_LABELS: Record<ModuleLayer, string> = {
  describe: '描述层',
  critique: '批判层',
  vision: '预测层',
};

export const LAYER_GROUPS: ReadonlyArray<{
  readonly layer: ModuleLayer;
  readonly heading: string;
  readonly range: string;
}> = [
  { layer: 'describe', heading: '描述层 · Describe', range: '01 – 09' },
  { layer: 'critique', heading: '批判层 · Critique', range: '10' },
  { layer: 'vision', heading: '预测层 · Vision', range: '11' },
];
