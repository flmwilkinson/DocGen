'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  LayoutTemplate, 
  Edit, 
  Copy, 
  ArrowLeft,
  FileText,
  Layers,
  Clock,
  ChevronDown,
  ChevronRight,
  Table,
  BarChart3,
  Type,
  MessageSquare,
  Settings
} from 'lucide-react';
import { useTemplatesStore, Template, TemplateSection, TemplateBlock, BlockType, flattenTemplateBlocks } from '@/store/templates';

const blockTypeIcons: Record<BlockType, typeof FileText> = {
  LLM_TEXT: FileText,
  LLM_TABLE: Table,
  LLM_CHART: BarChart3,
  STATIC_TEXT: Type,
  USER_INPUT: Settings,
};

const blockTypeLabels: Record<BlockType, string> = {
  LLM_TEXT: 'AI Generated Text',
  LLM_TABLE: 'AI Generated Table',
  LLM_CHART: 'AI Generated Chart',
  STATIC_TEXT: 'Static Content',
  USER_INPUT: 'User Provided Input',
};


export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;
  
  // Get template from store
  const getTemplate = useTemplatesStore((state) => state.getTemplate);
  const template = getTemplate(templateId);
  
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <LayoutTemplate className="h-16 w-16 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-medium">Template not found</h2>
        <button 
          onClick={() => router.push('/templates')}
          className="btn-primary mt-6"
        >
          Back to Templates
        </button>
      </div>
    );
  }

  const totalBlocks = flattenTemplateBlocks(template).length;

  const renderBlock = (block: TemplateBlock) => {
    const Icon = blockTypeIcons[block.type];
    const isExpanded = expandedBlocks.has(block.id);

    return (
      <div key={block.id} className="border border-glass-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleBlock(block.id)}
          className="w-full flex items-center gap-3 p-3 hover:bg-glass-bg transition-colors text-left"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded bg-glass-bg flex-shrink-0">
            <Icon className="h-4 w-4 text-brand-orange" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{block.title}</p>
            <p className="text-xs text-muted-foreground">{blockTypeLabels[block.type]}</p>
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-glass-border p-4 bg-glass-bg/50 space-y-4">
            {/* LLM Prompt */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="h-4 w-4 text-brand-orange" />
                <span className="text-sm font-medium">LLM Prompt / Instructions</span>
              </div>
              <div className="bg-background/50 rounded-lg p-3 border border-glass-border">
                <pre className="text-sm text-foreground/90 whitespace-pre-wrap font-mono">
                  {block.instructions}
                </pre>
              </div>
            </div>

            {/* Data Sources */}
            {block.dataSources && block.dataSources.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Data Sources</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {block.dataSources.map((source, idx) => (
                    <span 
                      key={idx}
                      className="px-2 py-1 text-xs rounded-full bg-zinc-700 text-zinc-200 border border-zinc-600"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (section: TemplateSection, depth: number = 0) => {
    const isExpanded = expandedSections.has(section.id);
    const hasContent = section.blocks.length > 0 || (section.subsections && section.subsections.length > 0);

    return (
      <div key={section.id} className={depth > 0 ? 'ml-6 border-l border-glass-border pl-4' : ''}>
        <button
          onClick={() => toggleSection(section.id)}
          className="w-full flex items-center gap-3 p-3 hover:bg-glass-bg rounded-lg transition-colors text-left"
        >
          {hasContent ? (
            isExpanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            )
          ) : (
            <div className="w-5" />
          )}
          <div className="flex-1">
            <p className="font-medium">{section.title}</p>
            {section.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{section.description}</p>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {section.blocks.length} block{section.blocks.length !== 1 ? 's' : ''}
            {section.subsections && section.subsections.length > 0 && (
              <>, {section.subsections.length} subsection{section.subsections.length !== 1 ? 's' : ''}</>
            )}
          </span>
        </button>

        {isExpanded && hasContent && (
          <div className="mt-2 space-y-3 pb-4">
            {/* Blocks */}
            {section.blocks.length > 0 && (
              <div className="space-y-2 ml-8">
                {section.blocks.map(renderBlock)}
              </div>
            )}

            {/* Subsections */}
            {section.subsections && section.subsections.map(sub => renderSection(sub, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Back Button */}
      <button 
        onClick={() => router.push('/templates')}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors shrink-0 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Templates
      </button>

      {/* Header */}
      <div className="flex items-start justify-between shrink-0 mb-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-orange/10">
            <LayoutTemplate className="h-7 w-7 text-brand-orange" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{template.name}</h1>
            <p className="mt-1 text-muted-foreground max-w-xl">
              {template.description}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => router.push(`/templates/${templateId}/edit`)}
            className="btn-primary flex items-center gap-2"
          >
            <Edit className="h-4 w-4" />
            Edit Template
          </button>
          <button className="btn-secondary flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Duplicate
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-card">
          <div className="flex items-center gap-3">
            <Layers className="h-5 w-5 text-brand-orange" />
            <div>
              <p className="text-2xl font-semibold">{template.sections.length}</p>
              <p className="text-sm text-muted-foreground">Sections</p>
            </div>
          </div>
        </div>
        <div className="glass-card">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-400" />
            <div>
              <p className="text-2xl font-semibold">{totalBlocks}</p>
              <p className="text-sm text-muted-foreground">Content Blocks</p>
            </div>
          </div>
        </div>
        <div className="glass-card">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-green-400" />
            <div>
              <p className="text-sm font-medium">{template.createdAt}</p>
              <p className="text-sm text-muted-foreground">Created</p>
            </div>
          </div>
        </div>
        <div className="glass-card">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-yellow-400" />
            <div>
              <p className="text-sm font-medium">{template.updatedAt}</p>
              <p className="text-sm text-muted-foreground">Last Updated</p>
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="glass-panel p-4 border-l-4 border-brand-orange">
        <p className="text-sm">
          <strong>Click on sections</strong> to expand them and see their content blocks. 
          <strong> Click on blocks</strong> to view the LLM prompts/instructions that will be used to generate content.
        </p>
      </div>

      {/* Sections - Scrollable */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h2 className="text-lg font-medium mb-4 shrink-0">Template Structure</h2>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar glass-panel divide-y divide-glass-border">
          {template.sections.map(section => renderSection(section))}
        </div>
      </div>

      {/* Use Template */}
      <div className="glass-panel p-6 shrink-0 mt-6">
        <h3 className="font-medium">Use this template</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a new documentation project using this template
        </p>
        <button 
          onClick={() => router.push(`/projects/new?template=${templateId}`)}
          className="btn-primary mt-4"
        >
          Create Project with Template
        </button>
      </div>
    </div>
  );
}
