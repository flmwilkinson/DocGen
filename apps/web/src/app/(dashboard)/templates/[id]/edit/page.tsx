'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  FileText,
  Table,
  BarChart3,
  Type,
  Settings,
  MessageSquare,
  Layers,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTemplatesStore, Template, TemplateSection, TemplateBlock, BlockType } from '@/store/templates';

const blockTypeOptions: { type: BlockType; label: string; icon: typeof FileText; description: string }[] = [
  { type: 'LLM_TEXT', label: 'AI Generated Text', icon: FileText, description: 'AI generates prose content' },
  { type: 'LLM_TABLE', label: 'AI Generated Table', icon: Table, description: 'AI generates a data table' },
  { type: 'LLM_CHART', label: 'AI Generated Chart', icon: BarChart3, description: 'AI describes a visualization' },
  { type: 'STATIC_TEXT', label: 'Static Content', icon: Type, description: 'Fixed text that doesn\'t change' },
  { type: 'USER_INPUT', label: 'User Provided', icon: Settings, description: 'User fills in this section' },
];

export default function TemplateEditorPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;
  
  const getTemplate = useTemplatesStore((state) => state.getTemplate);
  const updateTemplate = useTemplatesStore((state) => state.updateTemplate);
  
  const [template, setTemplate] = useState<Template | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Load template on mount
  useEffect(() => {
    const loadedTemplate = getTemplate(templateId);
    if (loadedTemplate) {
      setTemplate(loadedTemplate);
      // Expand all sections by default
      setExpandedSections(new Set(loadedTemplate.sections.map(s => s.id)));
    }
  }, [templateId, getTemplate]);
  
  const handleSave = async () => {
    if (!template) return;
    
    setIsSaving(true);
    
    // Update in store
    updateTemplate(templateId, {
      name: template.name,
      description: template.description,
      sections: template.sections,
    });
    
    setHasChanges(false);
    setIsSaving(false);
    
    router.push(`/templates/${templateId}`);
  };
  
  const updateSection = (sectionId: string, updates: Partial<TemplateSection>) => {
    if (!template) return;
    
    setTemplate({
      ...template,
      sections: template.sections.map(s =>
        s.id === sectionId ? { ...s, ...updates } : s
      ),
    });
    setHasChanges(true);
  };
  
  const updateBlock = (sectionId: string, blockId: string, updates: Partial<TemplateBlock>) => {
    if (!template) return;
    
    setTemplate({
      ...template,
      sections: template.sections.map(s =>
        s.id === sectionId
          ? {
              ...s,
              blocks: s.blocks.map(b =>
                b.id === blockId ? { ...b, ...updates } : b
              ),
            }
          : s
      ),
    });
    setHasChanges(true);
  };
  
  const addSection = () => {
    if (!template) return;
    
    const newSection: TemplateSection = {
      id: `s-${Date.now()}`,
      title: 'New Section',
      description: '',
      blocks: [],
    };
    
    setTemplate({
      ...template,
      sections: [...template.sections, newSection],
    });
    setExpandedSections(prev => new Set([...prev, newSection.id]));
    setHasChanges(true);
  };
  
  const addBlock = (sectionId: string) => {
    if (!template) return;
    
    const newBlock: TemplateBlock = {
      id: `b-${Date.now()}`,
      type: 'LLM_TEXT',
      title: 'New Block',
      instructions: 'Enter the instructions for the AI to generate this content...',
      dataSources: [],
    };
    
    setTemplate({
      ...template,
      sections: template.sections.map(s =>
        s.id === sectionId
          ? { ...s, blocks: [...s.blocks, newBlock] }
          : s
      ),
    });
    setExpandedBlocks(prev => new Set([...prev, newBlock.id]));
    setHasChanges(true);
  };
  
  const deleteSection = (sectionId: string) => {
    if (!template) return;
    
    setTemplate({
      ...template,
      sections: template.sections.filter(s => s.id !== sectionId),
    });
    setHasChanges(true);
  };
  
  const deleteBlock = (sectionId: string, blockId: string) => {
    if (!template) return;
    
    setTemplate({
      ...template,
      sections: template.sections.map(s =>
        s.id === sectionId
          ? { ...s, blocks: s.blocks.filter(b => b.id !== blockId) }
          : s
      ),
    });
    setHasChanges(true);
  };
  
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
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Template not found</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/templates/${templateId}`)}
            className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold">Edit Template</h1>
            <p className="text-sm text-muted-foreground">
              Modify sections, blocks, and AI prompts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-sm text-yellow-500">Unsaved changes</span>
          )}
          <button
            onClick={() => router.push(`/templates/${templateId}`)}
            className="btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="btn-primary disabled:opacity-50"
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
      
      {/* Template Details */}
      <div className="glass-panel p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Template Name</label>
          <input
            type="text"
            value={template.name}
            onChange={(e) => {
              setTemplate({ ...template, name: e.target.value });
              setHasChanges(true);
            }}
            className="input-glass w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={template.description}
            onChange={(e) => {
              setTemplate({ ...template, description: e.target.value });
              setHasChanges(true);
            }}
            rows={2}
            className="input-glass w-full resize-none"
          />
        </div>
      </div>
      
      {/* Sections - Scrollable */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between shrink-0 mb-4">
          <h2 className="text-lg font-medium">Sections</h2>
          <button onClick={addSection} className="btn-secondary text-sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Section
          </button>
        </div>
        
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-4">
        {template.sections.map((section, sectionIndex) => (
          <div key={section.id} className="glass-panel overflow-hidden">
            {/* Section Header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-glass-bg transition-colors"
              onClick={() => toggleSection(section.id)}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
              {expandedSections.has(section.id) ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
              <div className="flex-1">
                <span className="font-medium">{section.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({section.blocks.length} block{section.blocks.length !== 1 ? 's' : ''})
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSection(section.id);
                }}
                className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            
            {/* Section Content */}
            {expandedSections.has(section.id) && (
              <div className="border-t border-glass-border p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Section Title</label>
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) => updateSection(section.id, { title: e.target.value })}
                      className="input-glass w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Description (optional)</label>
                    <input
                      type="text"
                      value={section.description || ''}
                      onChange={(e) => updateSection(section.id, { description: e.target.value })}
                      placeholder="Brief description..."
                      className="input-glass w-full text-sm"
                    />
                  </div>
                </div>
                
                {/* Blocks */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Content Blocks</span>
                    <button
                      onClick={() => addBlock(section.id)}
                      className="btn-ghost text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Block
                    </button>
                  </div>
                  
                  {section.blocks.map((block) => {
                    const blockTypeInfo = blockTypeOptions.find(b => b.type === block.type);
                    const BlockIcon = blockTypeInfo?.icon || FileText;
                    
                    return (
                      <div key={block.id} className="border border-glass-border rounded-lg overflow-hidden">
                        <div
                          className="flex items-center gap-3 p-3 bg-glass-bg/50 cursor-pointer"
                          onClick={() => toggleBlock(block.id)}
                        >
                          {expandedBlocks.has(block.id) ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-glass-bg">
                            <BlockIcon className="h-4 w-4 text-brand-orange" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{block.title}</p>
                            <p className="text-xs text-muted-foreground">{blockTypeInfo?.label}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBlock(section.id, block.id);
                            }}
                            className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        
                        {expandedBlocks.has(block.id) && (
                          <div className="p-4 space-y-4 border-t border-glass-border">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium mb-2">Block Title</label>
                                <input
                                  type="text"
                                  value={block.title}
                                  onChange={(e) => updateBlock(section.id, block.id, { title: e.target.value })}
                                  className="input-glass w-full text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium mb-2">Block Type</label>
                                <select
                                  value={block.type}
                                  onChange={(e) => updateBlock(section.id, block.id, { type: e.target.value as BlockType })}
                                  className="input-glass w-full text-sm bg-background text-foreground [&>option]:bg-zinc-900 [&>option]:text-foreground"
                                >
                                  {blockTypeOptions.map((opt) => (
                                    <option key={opt.type} value={opt.type} className="bg-zinc-900 text-white py-2">
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            
                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium mb-2">
                                <MessageSquare className="h-4 w-4 text-brand-orange" />
                                LLM Prompt / Instructions
                              </label>
                              <p className="text-xs text-muted-foreground mb-2">
                                This is the exact prompt sent to the AI to generate content for this block.
                              </p>
                              <textarea
                                value={block.instructions}
                                onChange={(e) => updateBlock(section.id, block.id, { instructions: e.target.value })}
                                rows={6}
                                className="input-glass w-full text-sm font-mono resize-y"
                                placeholder="Enter the instructions for the AI..."
                              />
                            </div>
                            
                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium mb-2">
                                <Layers className="h-4 w-4 text-muted-foreground" />
                                Data Sources
                              </label>
                              <p className="text-xs text-muted-foreground mb-2">
                                What data/context should be passed to the LLM for this block?
                              </p>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {(block.dataSources || []).map((source, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-zinc-700 text-zinc-200 border border-zinc-600"
                                  >
                                    {source}
                                    <button
                                      onClick={() => {
                                        const newSources = (block.dataSources || []).filter((_, i) => i !== idx);
                                        updateBlock(section.id, block.id, { dataSources: newSources });
                                      }}
                                      className="hover:text-red-400"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                              <input
                                type="text"
                                placeholder="Type a data source and press Enter..."
                                className="input-glass w-full text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const input = e.currentTarget;
                                    const value = input.value.trim();
                                    if (value) {
                                      updateBlock(section.id, block.id, {
                                        dataSources: [...(block.dataSources || []), value],
                                      });
                                      input.value = '';
                                    }
                                  }
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {section.blocks.length === 0 && (
                    <div className="text-center py-6 text-muted-foreground border border-dashed border-glass-border rounded-lg">
                      <p className="text-sm">No blocks in this section</p>
                      <button
                        onClick={() => addBlock(section.id)}
                        className="text-brand-orange text-sm hover:underline mt-2"
                      >
                        Add your first block
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        
        {template.sections.length === 0 && (
          <div className="text-center py-12 glass-panel">
            <p className="text-muted-foreground mb-4">No sections yet</p>
            <button onClick={addSection} className="btn-primary">
              <Plus className="h-4 w-4 mr-2" />
              Add First Section
            </button>
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
