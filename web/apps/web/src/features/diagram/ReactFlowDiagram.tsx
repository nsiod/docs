import type { FlowNodeData } from '@/features/ecosystem/graph-data';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
} from 'reactflow';
import { nodeTypes } from './node-types';

interface ReactFlowDiagramProps {
  readonly nodes: Node<FlowNodeData>[];
  readonly edges: Edge[];
  readonly height?: number;
  readonly showMiniMap?: boolean;
}

export function ReactFlowDiagram({
  nodes,
  edges,
  height = 520,
  showMiniMap = false,
}: ReactFlowDiagramProps) {
  const navigate = useNavigate();
  const types = useMemo(() => nodeTypes, []);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node<FlowNodeData>) => {
      const link = node.data.moduleLink;
      if (link)
        void navigate({ to: '/modules/$moduleId', params: { moduleId: link } });
    },
    [navigate],
  );

  return (
    <div className="rounded-lg border bg-card" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={types}
        onNodeClick={handleNodeClick}
        fitView
        minZoom={0.3}
        maxZoom={1.8}
        nodesDraggable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} color="var(--color-border)" />
        <Controls showInteractive={false} />
        {showMiniMap && <MiniMap pannable zoomable />}
      </ReactFlow>
    </div>
  );
}
