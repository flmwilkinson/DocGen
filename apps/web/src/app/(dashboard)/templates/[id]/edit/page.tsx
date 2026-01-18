'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FileText,
  Table,
  BarChart3,
  Type,
  Settings,
  MessageSquare,
  Layers,
  X,
  GripVertical,
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
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Load template on mount
  useEffect(() => {
    const loadedTemplate = getTemplate(templateId);
    if (loadedTemplate) {
      setTemplate(loadedTemplate);
      // Select first section by default
      if (loadedTemplate.sections.length > 0) {
        setSelectedSectionId(loadedTemplate.sections[0].id);
      }
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
    setSelectedSectionId(newSection.id);
    setHasChanges(true);
  };
  
  const addSubsection = (parentSectionId: string) => {
    if (!template) return;
    
    const newSubsection: TemplateSection = {
      id: `s-${Date.now()}`,
      title: 'New Subsection',
      description: '',
      blocks: [],
    };
    
    setTemplate({
      ...template,
      sections: template.sections.map(s =>
        s.id === parentSectionId
          ? {
              ...s,
              subsections: [...(s.subsections || []), newSubsection],
            }
          : s
      ),
    });
    setSelectedSectionId(newSubsection.id);
    setHasChanges(true);
  };
  
  const addBlock = (sectionId: string, insertAfterBlockId?: string) => {
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
      sections: template.sections.map(s => {
        if (s.id === sectionId) {
          if (insertAfterBlockId) {
            const blockIndex = s.blocks.findIndex(b => b.id === insertAfterBlockId);
            const newBlocks = [...s.blocks];
            newBlocks.splice(blockIndex + 1, 0, newBlock);
            return { ...s, blocks: newBlocks };
          }
          return { ...s, blocks: [...s.blocks, newBlock] };
        }
        // Also check subsections
        if (s.subsections) {
          return {
            ...s,
            subsections: s.subsections.map(sub => {
              if (sub.id === sectionId) {
                if (insertAfterBlockId) {
                  const blockIndex = sub.blocks.findIndex(b => b.id === insertAfterBlockId);
                  const newBlocks = [...sub.blocks];
                  newBlocks.splice(blockIndex + 1, 0, newBlock);
                  return { ...sub, blocks: newBlocks };
                }
                return { ...sub, blocks: [...sub.blocks, newBlock] };
              }
              return sub;
            }),
          };
        }
        return s;
      }),
    });
    setSelectedBlockId(newBlock.id);
    setHasChanges(true);
  };
  
  const deleteSection = (sectionId: string) => {
    if (!template) return;
    
    setTemplate({
      ...template,
      sections: template.sections
        .map(s => ({
          ...s,
          subsections: s.subsections?.filter(sub => sub.id !== sectionId),
        }))
        .filter(s => s.id !== sectionId),
    });
    
    // Select another section if current was deleted
    const remainingSections = template.sections.filter(s => s.id !== sectionId);
    if (selectedSectionId === sectionId && remainingSections.length > 0) {
      setSelectedSectionId(remainingSections[0].id);
    } else if (remainingSections.length === 0) {
      setSelectedSectionId(null);
    }
    setHasChanges(true);
  };
  
  const deleteBlock = (sectionId: string, blockId: string) => {
    if (!template) return;
    
    setTemplate({
      ...template,
      sections: template.sections.map(s => {
        if (s.id === sectionId) {
          return { ...s, blocks: s.blocks.filter(b => b.id !== blockId) };
        }
        if (s.subsections) {
          return {
            ...s,
            subsections: s.subsections.map(sub =>
              sub.id === sectionId
                ? { ...sub, blocks: sub.blocks.filter(b => b.id !== blockId) }
                : sub
            ),
          };
        }
        return s;
      }),
    });
    setHasChanges(true);
  };
  
  const findSection = (sectionId: string): TemplateSection | null => {
    if (!template) return null;
    
    // Check main sections
    const mainSection = template.sections.find(s => s.id === sectionId);
    if (mainSection) return mainSection;
    
    // Check subsections
    for (const section of template.sections) {
      if (section.subsections) {
        const subsection = section.subsections.find(sub => sub.id === sectionId);
        if (subsection) return subsection;
      }
    }
    
    return null;
  };
  
  if (!template) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Template not found</p>
      </div>
    );
  }
  
  const selectedSection = selectedSectionId ? findSection(selectedSectionId) : null;
  
  return (
    <div className="flex h-full overflow-hidden px-6 pt-6">
      {/* Outline Sidebar */}
      <div className={cn(
        "shrink-0 border-r border-glass-border bg-background/50 transition-all duration-300 flex flex-col",
        isOutlineCollapsed ? "w-0" : "w-64"
      )}>
        {!isOutlineCollapsed && (
          <>
            <div className="h-12 px-4 border-b border-glass-border flex items-center justify-between shrink-0">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Outline
              </h3>
              <button
                onClick={() => setIsOutlineCollapsed(true)}
                className="p-1 hover:bg-glass-bg rounded"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              <div className="space-y-2">
                {template.sections.map((section, index) => (
                  <div key={section.id} className="space-y-1">
                    {/* Main Section */}
                    <div className="flex items-center gap-1 group">
                      <button
                        onClick={() => setSelectedSectionId(section.id)}
                        className={cn(
                          "flex-1 text-left px-3 py-2 rounded-lg text-sm transition-colors",
                          selectedSectionId === section.id
                            ? "bg-brand-orange/10 text-brand-orange font-medium"
                            : "text-muted-foreground hover:bg-glass-bg hover:text-foreground"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-xs opacity-50">{index + 1}</span>
                          <span className="truncate">{section.title || 'Untitled Section'}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => addSubsection(section.id)}
                        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-glass-bg rounded transition-opacity"
                        title="Add subsection"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSection(section.id);
                        }}
                        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 rounded transition-opacity"
                        title="Delete section"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    
                    {/* Subsections */}
                    {section.subsections && section.subsections.length > 0 && (
                      <div className="ml-6 space-y-1">
                        {section.subsections.map((subsection, subIndex) => (
                          <div key={subsection.id} className="flex items-center gap-1 group">
                            <button
                              onClick={() => setSelectedSectionId(subsection.id)}
                              className={cn(
                                "flex-1 text-left px-3 py-1.5 rounded-lg text-xs transition-colors",
                                selectedSectionId === subsection.id
                                  ? "bg-brand-orange/10 text-brand-orange font-medium"
                                  : "text-muted-foreground hover:bg-glass-bg hover:text-foreground"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <span className="text-[10px] opacity-50">{index + 1}.{subIndex + 1}</span>
                                <span className="truncate">{subsection.title || 'Untitled Subsection'}</span>
                              </span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSection(subsection.id);
                              }}
                              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 rounded transition-opacity"
                              title="Delete subsection"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                
                {/* Add Section Button */}
                <button
                  onClick={addSection}
                  className="w-full mt-4 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-glass-bg rounded-lg border border-dashed border-glass-border transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Section
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Toggle Outline Button (when collapsed) */}
      {isOutlineCollapsed && (
        <button
          onClick={() => setIsOutlineCollapsed(false)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-secondary/50 dark:bg-secondary/30 border border-glass-border rounded-r-lg p-1 hover:bg-secondary/70 dark:hover:bg-secondary/50 transition-colors text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-glass-border bg-background/50 px-6">
          <div className="h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push(`/templates/${templateId}`)}
                className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-semibold">Edit Template</h1>
                <p className="text-sm text-muted-foreground">
                  {template.name}
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
        </div>
        
        {/* Template Details */}
        <div className="shrink-0 border-b border-glass-border bg-background/30 px-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground uppercase tracking-wide">
                Template Name
              </label>
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
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground uppercase tracking-wide">
                Description
              </label>
              <input
                type="text"
                value={template.description}
                onChange={(e) => {
                  setTemplate({ ...template, description: e.target.value });
                  setHasChanges(true);
                }}
                placeholder="Brief description of this template..."
                className="input-glass w-full"
              />
            </div>
          </div>
        </div>
        
        {/* Section/Block Editor - Takes up at least half the screen */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {selectedSection ? (
            <div className="max-w-4xl mx-auto p-8">
              {/* Section Header */}
              <div className="mb-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Section Title</label>
                  <input
                    type="text"
                    value={selectedSection.title}
                    onChange={(e) => updateSection(selectedSectionId!, { title: e.target.value })}
                    className="input-glass w-full text-lg"
                    placeholder="Section title..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Description (optional)</label>
                  <input
                    type="text"
                    value={selectedSection.description || ''}
                    onChange={(e) => updateSection(selectedSectionId!, { description: e.target.value })}
                    placeholder="Brief description of this section..."
                    className="input-glass w-full"
                  />
                </div>
              </div>
              
              {/* Blocks */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Content Blocks
                  </h3>
                  {selectedSection.blocks.length === 0 && (
                    <button
                      onClick={() => addBlock(selectedSectionId!)}
                      className="btn-secondary text-sm"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add First Block
                    </button>
                  )}
                </div>
                
                {selectedSection.blocks.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-glass-border rounded-lg">
                    <p className="text-muted-foreground mb-4">No blocks in this section</p>
                    <button
                      onClick={() => addBlock(selectedSectionId!)}
                      className="btn-primary"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Block
                    </button>
                  </div>
                ) : (
                  <div className="relative space-y-6">
                    {selectedSection.blocks.map((block, blockIndex) => {
                    const blockTypeInfo = blockTypeOptions.find(b => b.type === block.type);
                    const BlockIcon = blockTypeInfo?.icon || FileText;
                    const isSelected = selectedBlockId === block.id;
                    
                    return (
                      <div key={block.id} className="relative">
                        {/* Insert Block Button Above - Only for first block, positioned in gap above and to the right */}
                        {blockIndex === 0 && (
                          <div className="absolute -top-5 -right-10 z-10">
                            <button
                              onClick={() => {
                                // Add at beginning
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
                                    s.id === selectedSectionId!
                                      ? { ...s, blocks: [newBlock, ...s.blocks] }
                                      : s
                                  ),
                                });
                                setSelectedBlockId(newBlock.id);
                                setHasChanges(true);
                              }}
                              className="w-6 h-6 rounded-full bg-brand-orange/80 border border-brand-orange text-white shadow-md hover:bg-brand-orange hover:scale-110 transition-all flex items-center justify-center"
                              title="Add block at beginning"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        
                        {/* Block Card */}
                        <div
                          className={cn(
                            "glass-panel border-2 transition-all relative",
                            isSelected ? "border-brand-orange/50" : "border-glass-border"
                          )}
                        >
                          {/* Block Header */}
                          <div
                            className="flex items-center gap-3 p-4 cursor-pointer hover:bg-glass-bg transition-colors"
                            onClick={() => setSelectedBlockId(isSelected ? null : block.id)}
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
                              <BlockIcon className="h-5 w-5 text-brand-orange" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{block.title}</p>
                              <p className="text-xs text-muted-foreground">{blockTypeInfo?.label}</p>
                            </div>
                            {isSelected ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteBlock(selectedSectionId!, block.id);
                              }}
                              className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          
                          {/* Block Content - Full Width */}
                          {isSelected && (
                            <div className="p-6 space-y-6 border-t border-glass-border">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium mb-2">Block Title</label>
                                  <input
                                    type="text"
                                    value={block.title}
                                    onChange={(e) => updateBlock(selectedSectionId!, block.id, { title: e.target.value })}
                                    className="input-glass w-full"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium mb-2">Block Type</label>
                                  <select
                                    value={block.type}
                                    onChange={(e) => updateBlock(selectedSectionId!, block.id, { type: e.target.value as BlockType })}
                                    className="input-glass w-full bg-background text-foreground"
                                  >
                                    {blockTypeOptions.map((opt) => (
                                      <option key={opt.type} value={opt.type}>
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
                                  onChange={(e) => updateBlock(selectedSectionId!, block.id, { instructions: e.target.value })}
                                  rows={10}
                                  className="input-glass w-full font-mono resize-y"
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
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-secondary/50 dark:bg-secondary/30 text-foreground border border-glass-border"
                                    >
                                      {source}
                                      <button
                                        onClick={() => {
                                          const newSources = (block.dataSources || []).filter((_, i) => i !== idx);
                                          updateBlock(selectedSectionId!, block.id, { dataSources: newSources });
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
                                  className="input-glass w-full"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const input = e.currentTarget;
                                      const value = input.value.trim();
                                      if (value) {
                                        updateBlock(selectedSectionId!, block.id, {
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
                        
                        {/* Insert Block Button Between Blocks - Positioned in the gap below, to the right */}
                        {blockIndex < selectedSection.blocks.length - 1 && (
                          <div className="absolute -bottom-5 -right-10 z-10">
                            <button
                              onClick={() => addBlock(selectedSectionId!, block.id)}
                              className="w-6 h-6 rounded-full bg-brand-orange/80 border border-brand-orange text-white shadow-md hover:bg-brand-orange hover:scale-110 transition-all flex items-center justify-center"
                              title="Insert block here"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Add Block Button After Last Block - Positioned in gap below last block, to the right */}
                  <div className="relative">
                    <div className="absolute -top-5 -right-10 z-10">
                      <button
                        onClick={() => {
                          const lastBlockId = selectedSection.blocks[selectedSection.blocks.length - 1].id;
                          addBlock(selectedSectionId!, lastBlockId);
                        }}
                        className="w-6 h-6 rounded-full bg-brand-orange/80 border border-brand-orange text-white shadow-md hover:bg-brand-orange hover:scale-110 transition-all flex items-center justify-center"
                        title="Add block at end"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-muted-foreground mb-4">Select a section from the outline to edit</p>
                <button onClick={addSection} className="btn-primary">
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Section
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
