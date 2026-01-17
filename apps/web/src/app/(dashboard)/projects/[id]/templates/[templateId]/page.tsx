'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  Plus,
  Save,
  Eye,
  Code,
  FileText,
  Table,
  BarChart2,
  FormInput,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Block type definitions
const BLOCK_TYPES = [
  { type: 'STATIC_TEXT', label: 'Static Text', icon: FileText, color: 'text-gray-400' },
  { type: 'LLM_TEXT', label: 'AI Text', icon: FileText, color: 'text-blue-400' },
  { type: 'LLM_TABLE', label: 'AI Table', icon: Table, color: 'text-green-400' },
  { type: 'LLM_CHART', label: 'AI Chart', icon: BarChart2, color: 'text-purple-400' },
  { type: 'USER_INPUT', label: 'User Input', icon: FormInput, color: 'text-orange-400' },
] as const;

// Mock template data
const mockTemplate = {
  id: '1',
  name: 'Model Documentation',
  sections: [
    {
      id: 's1',
      title: 'Executive Summary',
      level: 1,
      blocks: [
        { id: 'b1', type: 'LLM_TEXT', title: 'Model Overview', instructions: 'Summarize the model purpose and key findings' },
      ],
      childrenSections: [],
    },
    {
      id: 's2',
      title: 'Model Development',
      level: 1,
      blocks: [],
      childrenSections: [
        {
          id: 's2-1',
          title: 'Data Description',
          level: 2,
          blocks: [
            { id: 'b2', type: 'LLM_TABLE', title: 'Data Sources', instructions: 'List all data sources used' },
            { id: 'b3', type: 'LLM_TEXT', title: 'Data Quality', instructions: 'Describe data quality assessment' },
          ],
          childrenSections: [],
        },
        {
          id: 's2-2',
          title: 'Methodology',
          level: 2,
          blocks: [
            { id: 'b4', type: 'LLM_TEXT', title: 'Algorithm Selection', instructions: 'Explain model algorithm choice' },
          ],
          childrenSections: [],
        },
      ],
    },
    {
      id: 's3',
      title: 'Performance Metrics',
      level: 1,
      blocks: [
        { id: 'b5', type: 'LLM_CHART', title: 'ROC Curve', instructions: 'Generate ROC curve visualization' },
        { id: 'b6', type: 'LLM_TABLE', title: 'Metrics Summary', instructions: 'Table of key performance metrics' },
      ],
      childrenSections: [],
    },
  ],
};

export default function TemplateBuilderPage() {
  const params = useParams();
  const [showJson, setShowJson] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(mockTemplate.sections.map(s => s.id))
  );

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-6">
      {/* Section Tree (Left Panel) */}
      <div className="w-72 shrink-0">
        <div className="glass-panel h-full flex flex-col">
          <div className="border-b border-glass-border p-4">
            <h2 className="font-semibold">Sections</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Drag to reorder sections
            </p>
          </div>
          
          <div className="flex-1 overflow-auto p-4 custom-scrollbar">
            {mockTemplate.sections.map((section) => (
              <SectionTreeItem
                key={section.id}
                section={section}
                expanded={expandedSections}
                onToggle={toggleSection}
                selectedBlock={selectedBlock}
                onSelectBlock={setSelectedBlock}
              />
            ))}
            
            <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-glass-border p-3 text-sm text-muted-foreground transition-colors hover:border-brand-orange hover:text-brand-orange">
              <Plus className="h-4 w-4" />
              Add Section
            </button>
          </div>
        </div>
      </div>

      {/* Block Editor (Center Panel) */}
      <div className="flex-1">
        <div className="glass-panel h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-glass-border p-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Link href={`/projects/${params.id}`} className="hover:text-foreground">
                  Project
                </Link>
                <ChevronRight className="h-4 w-4" />
                <span>Template</span>
              </div>
              <h1 className="text-xl font-bold">{mockTemplate.name}</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowJson(!showJson)}
                className={cn('btn-ghost', showJson && 'bg-glass-bg')}
              >
                <Code className="mr-2 h-4 w-4" />
                JSON
              </button>
              <button className="btn-secondary">
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </button>
              <button className="btn-primary">
                <Save className="mr-2 h-4 w-4" />
                Save
              </button>
            </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 overflow-auto p-6 custom-scrollbar">
            {selectedBlock ? (
              <BlockEditor blockId={selectedBlock} />
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Select a Block</h3>
                  <p className="text-sm text-muted-foreground">
                    Click on a block in the section tree to edit it
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* JSON Preview (Right Panel - Collapsible) */}
      {showJson && (
        <div className="w-96 shrink-0">
          <div className="glass-panel h-full flex flex-col">
            <div className="border-b border-glass-border p-4">
              <h2 className="font-semibold">Template JSON</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Live preview of the template schema
              </p>
            </div>
            <div className="flex-1 overflow-auto p-4 custom-scrollbar">
              <pre className="text-xs text-muted-foreground font-mono">
                {JSON.stringify(mockTemplate, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTreeItem({
  section,
  expanded,
  onToggle,
  selectedBlock,
  onSelectBlock,
  depth = 0,
}: {
  section: typeof mockTemplate.sections[0];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedBlock: string | null;
  onSelectBlock: (id: string) => void;
  depth?: number;
}) {
  const isExpanded = expanded.has(section.id);
  const hasChildren = section.childrenSections.length > 0 || section.blocks.length > 0;

  return (
    <div className="mb-1">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg p-2 text-sm cursor-pointer transition-colors',
          'hover:bg-glass-bg'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground opacity-50" />
        
        {hasChildren && (
          <button onClick={() => onToggle(section.id)} className="p-0.5">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
        
        <span className="flex-1 truncate font-medium">{section.title}</span>
        
        <button className="p-1 opacity-0 group-hover:opacity-100 hover:text-brand-orange">
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Blocks */}
          {section.blocks.map((block) => {
            const blockType = BLOCK_TYPES.find(t => t.type === block.type);
            const Icon = blockType?.icon || FileText;
            
            return (
              <div
                key={block.id}
                onClick={() => onSelectBlock(block.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg p-2 text-sm cursor-pointer transition-colors',
                  selectedBlock === block.id
                    ? 'bg-brand-orange/10 text-brand-orange'
                    : 'hover:bg-glass-bg'
                )}
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <Icon className={cn('h-4 w-4', blockType?.color)} />
                <span className="flex-1 truncate">{block.title}</span>
              </div>
            );
          })}

          {/* Child Sections */}
          {section.childrenSections.map((child) => (
            <SectionTreeItem
              key={child.id}
              section={child}
              expanded={expanded}
              onToggle={onToggle}
              selectedBlock={selectedBlock}
              onSelectBlock={onSelectBlock}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </div>
  );
}

function BlockEditor({ blockId }: { blockId: string }) {
  // Find block from mock data
  const block = { id: blockId, type: 'LLM_TEXT', title: 'Model Overview', instructions: 'Summarize the model purpose' };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="text-sm font-medium mb-2 block">Block Title</label>
        <input
          type="text"
          defaultValue={block.title}
          className="input-glass"
        />
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">Block Type</label>
        <div className="grid grid-cols-2 gap-2">
          {BLOCK_TYPES.map((type) => (
            <button
              key={type.type}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left transition-all',
                block.type === type.type
                  ? 'border-brand-orange bg-brand-orange/10'
                  : 'border-glass-border hover:border-brand-grey/50'
              )}
            >
              <type.icon className={cn('h-5 w-5', type.color)} />
              <span className="text-sm">{type.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">Instructions</label>
        <textarea
          defaultValue={block.instructions}
          rows={4}
          className="input-glass resize-none"
          placeholder="Describe what the AI should generate for this block..."
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Be specific about the expected content, format, and any data sources to use.
        </p>
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">Input References</label>
        <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-glass-border p-4 text-sm text-muted-foreground transition-colors hover:border-brand-orange hover:text-brand-orange">
          <Plus className="h-4 w-4" />
          Add Input Reference
        </button>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-glass-border">
        <button className="btn-ghost text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Block
        </button>
        <button className="btn-primary">
          Save Block
        </button>
      </div>
    </div>
  );
}

