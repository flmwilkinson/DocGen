'use client';

import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutTemplate, Plus, X, FileText, Upload, Wand2, Loader2, AlertCircle, Edit3, Trash2, MoreVertical } from 'lucide-react';
import { useTemplatesStore, flattenTemplateBlocks } from '@/store/templates';
import { processDocumentToTemplate } from '@/lib/document-parser';

export default function TemplatesPage() {
  const router = useRouter();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createMode, setCreateMode] = useState<'manual' | 'upload' | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingMessage, setProcessingMessage] = useState('');
  const [processingError, setProcessingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get templates from store
  const templates = useTemplatesStore((state) => state.templates);
  const addTemplate = useTemplatesStore((state) => state.addTemplate);
  const updateTemplate = useTemplatesStore((state) => state.updateTemplate);
  const deleteTemplate = useTemplatesStore((state) => state.deleteTemplate);
  
  // Memoize block counts to avoid recalculating on every render
  const templateBlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    templates.forEach((template) => {
      counts.set(template.id, flattenTemplateBlocks(template).length);
    });
    return counts;
  }, [templates]);
  
  // Rename dialog state
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameTemplateId, setRenameTemplateId] = useState<string | null>(null);
  const [renameTemplateName, setRenameTemplateName] = useState('');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) return;
    
    if (createMode === 'manual') {
      // Create a new template with default structure
      const newTemplateId = addTemplate({
        name: newTemplateName,
        description: 'New template - add sections and blocks',
        sections: [
          {
            id: `s-${Date.now()}`,
            title: 'Introduction',
            description: 'Overview section',
            blocks: [
              {
                id: `b-${Date.now()}`,
                type: 'LLM_TEXT',
                title: 'Overview',
                instructions: 'Write an introduction for this document...',
                dataSources: ['Repository README'],
              },
            ],
          },
        ],
      });
      router.push(`/templates/${newTemplateId}/edit`);
    } else if (createMode === 'upload' && uploadedFile) {
      // Process uploaded document to create template using AI
      setIsProcessing(true);
      setProcessingError(null);
      setProcessingProgress(0);
      setProcessingMessage('Starting document analysis...');
      
      try {
        const generatedTemplate = await processDocumentToTemplate(
          uploadedFile,
          (progress, message) => {
            setProcessingProgress(progress);
            setProcessingMessage(message);
          }
        );
        
        // Create the template in the store
        const newTemplateId = addTemplate({
          name: newTemplateName || generatedTemplate.name,
          description: generatedTemplate.description,
          sections: generatedTemplate.sections,
        });
        
        setIsProcessing(false);
        router.push(`/templates/${newTemplateId}/edit`);
      } catch (error) {
        console.error('Document processing error:', error);
        setProcessingError(
          error instanceof Error 
            ? error.message 
            : 'Failed to process document. Please try again.'
        );
        setIsProcessing(false);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      if (!newTemplateName) {
        setNewTemplateName(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleTemplateClick = (templateId: string) => {
    router.push(`/templates/${templateId}`);
  };

  const handleRenameTemplate = (templateId: string, currentName: string) => {
    setRenameTemplateId(templateId);
    setRenameTemplateName(currentName);
    setShowRenameDialog(true);
    setActiveDropdown(null);
  };

  const handleSaveRename = () => {
    if (renameTemplateId && renameTemplateName.trim()) {
      updateTemplate(renameTemplateId, { name: renameTemplateName.trim() });
      setShowRenameDialog(false);
      setRenameTemplateId(null);
      setRenameTemplateName('');
    }
  };

  const handleDeleteTemplate = (templateId: string, templateName: string) => {
    setActiveDropdown(null);
    if (confirm(`Delete "${templateName}"? This cannot be undone.`)) {
      deleteTemplate(templateId);
    }
  };

  const resetDialog = () => {
    setShowCreateDialog(false);
    setCreateMode(null);
    setNewTemplateName('');
    setUploadedFile(null);
    setIsProcessing(false);
    setProcessingProgress(0);
    setProcessingMessage('');
    setProcessingError(null);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="mt-1 text-muted-foreground">
            Browse, create, and manage documentation templates
          </p>
        </div>
        <button 
          onClick={() => setShowCreateDialog(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Template
        </button>
      </div>

      {/* Templates Grid - Scrollable */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h2 className="text-lg font-medium mb-4 shrink-0">Available Templates</h2>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar overflow-x-hidden">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 pb-4 w-full min-w-0">
          {templates.map((template) => {
            const blocksCount = templateBlockCounts.get(template.id) || 0;
            return (
              <div
                key={template.id}
                className="glass-card cursor-pointer transition-all hover:scale-[1.02] hover:border-brand-orange/50 group relative min-w-0 overflow-hidden"
              >
                {/* Actions Dropdown */}
                <div className="absolute top-4 right-4 z-20">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setActiveDropdown(activeDropdown === template.id ? null : template.id);
                    }}
                    className={`p-1.5 rounded-lg hover:bg-glass-bg-light text-muted-foreground hover:text-foreground transition-all ${
                      activeDropdown === template.id ? 'opacity-100 bg-glass-bg-light' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  
                  {activeDropdown === template.id && (
                    <>
                      {/* Backdrop to close dropdown */}
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDropdown(null);
                        }}
                      />
                      <div className="absolute right-0 top-8 w-36 bg-background border border-glass-border rounded-lg shadow-xl py-1 z-30">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleRenameTemplate(template.id, template.name);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-glass-bg-light transition-colors text-left"
                        >
                          <Edit3 className="h-4 w-4" />
                          Rename
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleDeleteTemplate(template.id, template.name);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
                
                <div 
                  onClick={() => handleTemplateClick(template.id)}
                  className="flex items-start gap-4 min-w-0"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-orange/10 shrink-0">
                    <LayoutTemplate className="h-6 w-6 text-brand-orange" />
                  </div>
                  <div className="flex-1 min-w-0 pr-8">
                    <h3 className="font-medium">{template.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {template.description}
                    </p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                      <span>{template.sections.length} sections</span>
                      <span>{blocksCount} blocks</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      {/* Create Template Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40 backdrop-blur-md">
          <div className="glass-panel relative w-full max-w-lg p-6 mx-4 shadow-2xl border border-glass-border/50 bg-gradient-to-br from-glass-bg/95 via-glass-bg/90 to-glass-bg/85 dark:from-glass-bg/95 dark:via-glass-bg/90 dark:to-brand-orange/5 light:from-white/95 light:via-white/92 light:to-white/88">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Create New Template</h2>
              <button
                onClick={resetDialog}
                className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!createMode ? (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Choose how you want to create your template:
                </p>
                
                <button
                  onClick={() => setCreateMode('manual')}
                  className="w-full p-4 rounded-lg border-2 border-glass-border hover:border-brand-orange/50 transition-all text-left bg-secondary/50 dark:bg-secondary/30 hover:bg-secondary/70 dark:hover:bg-secondary/50 text-foreground"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-orange/10 dark:bg-brand-orange/20">
                      <FileText className="h-6 w-6 text-brand-orange" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Manual Builder</p>
                      <p className="text-sm text-muted-foreground">
                        Create sections and blocks from scratch
                      </p>
                    </div>
                  </div>
                </button>
                
                <button
                  onClick={() => setCreateMode('upload')}
                  className="w-full p-4 rounded-lg border-2 border-glass-border hover:border-brand-orange/50 transition-all text-left bg-secondary/50 dark:bg-secondary/30 hover:bg-secondary/70 dark:hover:bg-secondary/50 text-foreground"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10 dark:bg-blue-500/20">
                      <Wand2 className="h-6 w-6 text-blue-400 dark:text-blue-300" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Generate from Document</p>
                      <p className="text-sm text-muted-foreground">
                        Upload a reference document to auto-generate template
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Template Name</label>
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g., Model Documentation"
                    className="input-glass w-full"
                    autoFocus
                  />
                </div>

                {createMode === 'upload' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Reference Document</label>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".pdf,.docx,.doc,.md,.txt"
                      className="hidden"
                    />
                    {uploadedFile ? (
                      <div className="flex items-center gap-3 p-3 bg-secondary/50 dark:bg-secondary/30 rounded-lg border border-glass-border">
                        <FileText className="h-5 w-5 text-brand-orange" />
                        <span className="text-sm flex-1 truncate text-foreground">{uploadedFile.name}</span>
                        <button
                          onClick={() => setUploadedFile(null)}
                          className="p-1 hover:bg-secondary/70 dark:hover:bg-secondary/50 rounded text-foreground"
                          disabled={isProcessing}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full p-8 border-2 border-dashed border-glass-border rounded-lg hover:border-brand-orange/50 transition-colors"
                      >
                        <div className="text-center">
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-sm text-muted-foreground">
                            Click to upload or drag and drop
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            DOCX, MD, TXT (PDF coming soon)
                          </p>
                        </div>
                      </button>
                    )}
                    
                    {/* Processing Progress */}
                    {isProcessing && (
                      <div className="mt-4 p-4 bg-secondary/50 dark:bg-secondary/30 rounded-lg border border-glass-border">
                        <div className="flex items-center gap-3 mb-2">
                          <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />
                          <span className="text-sm font-medium text-foreground">{processingMessage}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-secondary/50 dark:bg-secondary/40">
                          <div
                            className="h-full rounded-full bg-brand-orange transition-all duration-300"
                            style={{ width: `${processingProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          AI is analyzing document structure and generating prompts...
                        </p>
                      </div>
                    )}
                    
                    {/* Error Display */}
                    {processingError && (
                      <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-red-400">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-sm font-medium">Error</span>
                        </div>
                        <p className="text-sm text-red-300 mt-1">{processingError}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setCreateMode(null)}
                    className="btn-secondary flex-1"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCreateTemplate}
                    disabled={!newTemplateName.trim() || (createMode === 'upload' && !uploadedFile) || isProcessing}
                    className="btn-primary flex-1 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Template
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rename Template Dialog */}
      {showRenameDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40 backdrop-blur-md">
          <div className="glass-panel w-full max-w-md p-6 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Rename Template</h2>
              <button
                onClick={() => {
                  setShowRenameDialog(false);
                  setRenameTemplateId(null);
                  setRenameTemplateName('');
                }}
                className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Template Name</label>
                <input
                  type="text"
                  value={renameTemplateName}
                  onChange={(e) => setRenameTemplateName(e.target.value)}
                  placeholder="Enter template name"
                  className="input-glass w-full"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') {
                      setShowRenameDialog(false);
                      setRenameTemplateId(null);
                      setRenameTemplateName('');
                    }
                  }}
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowRenameDialog(false);
                    setRenameTemplateId(null);
                    setRenameTemplateName('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRename}
                  disabled={!renameTemplateName.trim()}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
