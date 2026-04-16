import type { FlowNodeData } from '@/features/ecosystem/graph-data';
import { memo } from 'react';
import { Handle, type NodeProps, Position } from 'reactflow';
import { cn } from '@/shared/lib/utils';

function CategoryNode({ data }: NodeProps<FlowNodeData>) {
  const variant = {
    component: 'rf-node-component',
    protocol: 'rf-node-protocol',
    data: 'rf-node-data',
    external: 'rf-node-external',
  }[data.category];

  return (
    <div className={cn(variant, 'min-w-[130px] shadow-sm hover:shadow')}>
      <Handle type="target" position={Position.Top} className="!bg-foreground/40" />
      <div className="text-[12px] font-semibold leading-tight whitespace-pre-line">
        {data.label}
      </div>
      {data.sublabel && (
        <div className="text-[10px] font-normal text-current/75 mt-0.5 leading-snug">
          {data.sublabel}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-foreground/40" />
    </div>
  );
}

export const nodeTypes = {
  nsioNode: memo(CategoryNode),
};
