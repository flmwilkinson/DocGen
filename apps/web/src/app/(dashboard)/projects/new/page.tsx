'use client';

import { useState, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  FolderKanban,
  GitBranch,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LayoutTemplate,
  X,
  FileText,
  Database,
  ChevronRight,
  Trash2,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useProjectsStore, type Artifact } from '@/store/projects';
import { useTemplatesStore } from '@/store/templates';

type Step = 'details' | 'source' | 'artifacts' | 'template' | 'review';

interface ArtifactFile {
  file: File;
  type: 'input' | 'output' | 'reference';
  description: string;
}

interface ProjectData {
  name: string;
  description: string;
  sourceType: 'github' | 'upload' | '';
  repoUrl: string;
  uploadedFiles: File[];
  artifacts: ArtifactFile[];
  templateId: string;
}

export default function NewProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTemplate = searchParams.get('template') || '';
  
  // Get all templates from store
  const templates = useTemplatesStore((state) => state.templates);
  const getTemplate = useTemplatesStore((state) => state.getTemplate);
  
  const [currentStep, setCurrentStep] = useState<Step>('details');
  const [isLoading, setIsLoading] = useState(false);
  const [repoStatus, setRepoStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [projectData, setProjectData] = useState<ProjectData>({
    name: '',
    description: '',
    sourceType: '',
    repoUrl: '',
    uploadedFiles: [],
    artifacts: [],
    templateId: preselectedTemplate,
  });

  const artifactInputRef = useRef<HTMLInputElement>(null);

  const steps: { key: Step; label: string; optional?: boolean }[] = [
    { key: 'details', label: 'Project Details' },
    { key: 'source', label: 'Code Source' },
    { key: 'artifacts', label: 'Reference Data', optional: true },
    { key: 'template', label: 'Template', optional: true },
    { key: 'review', label: 'Review & Create' },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === currentStep);

  const validateRepoUrl = async (url: string) => {
    if (!url) return;
    setRepoStatus('checking');
    
    // Simulate API check
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Basic validation
    if (url.includes('github.com/') && url.split('/').length >= 5) {
      setRepoStatus('valid');
    } else {
      setRepoStatus('invalid');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setProjectData(prev => ({
      ...prev,
      uploadedFiles: [...prev.uploadedFiles, ...files],
    }));
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setProjectData(prev => ({
      ...prev,
      uploadedFiles: [...prev.uploadedFiles, ...files],
    }));
  };

  const removeFile = (index: number) => {
    setProjectData(prev => ({
      ...prev,
      uploadedFiles: prev.uploadedFiles.filter((_, i) => i !== index),
    }));
  };

  const handleArtifactUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newArtifacts: ArtifactFile[] = files.map(file => ({
      file,
      type: 'reference' as const,
      description: '',
    }));
    setProjectData(prev => ({
      ...prev,
      artifacts: [...prev.artifacts, ...newArtifacts],
    }));
  };

  const handleArtifactDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const newArtifacts: ArtifactFile[] = files.map(file => ({
      file,
      type: 'reference' as const,
      description: '',
    }));
    setProjectData(prev => ({
      ...prev,
      artifacts: [...prev.artifacts, ...newArtifacts],
    }));
  };

  const updateArtifact = (index: number, updates: Partial<ArtifactFile>) => {
    setProjectData(prev => ({
      ...prev,
      artifacts: prev.artifacts.map((a, i) => i === index ? { ...a, ...updates } : a),
    }));
  };

  const removeArtifact = (index: number) => {
    setProjectData(prev => ({
      ...prev,
      artifacts: prev.artifacts.filter((_, i) => i !== index),
    }));
  };

  const addProject = useProjectsStore((state) => state.addProject);

  const handleCreate = async () => {
    setIsLoading(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Convert artifact files to Artifact objects
    const artifacts: Omit<Artifact, 'id'>[] = projectData.artifacts.map(a => ({
      name: a.file.name,
      type: a.type,
      fileType: a.file.name.split('.').pop() || 'unknown',
      size: a.file.size,
      description: a.description,
    }));
    
    // Add project to store
    const newProjectId = addProject({
      name: projectData.name,
      description: projectData.description,
      sourceType: projectData.sourceType as 'github' | 'upload',
      repoUrl: projectData.sourceType === 'github' ? projectData.repoUrl : undefined,
      uploadedFileNames: projectData.sourceType === 'upload' 
        ? projectData.uploadedFiles.map(f => f.name) 
        : undefined,
      templateId: projectData.templateId,
      templateName: getTemplate(projectData.templateId)?.name || 'No template selected',
      artifacts: artifacts as Artifact[],
    });
    
    setIsLoading(false);
    
    // Navigate to the new project (start generation only if a template was selected)
    if (projectData.templateId) {
      router.push(`/projects/${newProjectId}?generate=true`);
    } else {
      router.push(`/projects/${newProjectId}`);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'details':
        return projectData.name.trim().length > 0;
      case 'source':
        if (projectData.sourceType === 'github') {
          return repoStatus === 'valid';
        }
        if (projectData.sourceType === 'upload') {
          return projectData.uploadedFiles.length > 0;
        }
        return false;
      case 'artifacts':
        // Artifacts are optional, always allow proceeding
        return true;
      case 'template':
        return true;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const idx = currentStepIndex;
    if (idx < steps.length - 1) {
      setCurrentStep(steps[idx + 1].key);
    }
  };

  const prevStep = () => {
    const idx = currentStepIndex;
    if (idx > 0) {
      setCurrentStep(steps[idx - 1].key);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      <div className="max-w-3xl mx-auto w-full flex flex-col h-full">
      {/* Header */}
      <div>
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-orange/10">
            <FolderKanban className="h-6 w-6 text-brand-orange" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Create New Project</h1>
            <p className="text-muted-foreground">Set up a new documentation project</p>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-between overflow-x-auto pb-2 shrink-0 mb-8 mt-8">
        {steps.map((step, idx) => (
          <div key={step.key} className="flex items-center shrink-0">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                idx < currentStepIndex
                  ? 'bg-brand-orange text-white'
                  : idx === currentStepIndex
                  ? 'bg-brand-orange/20 text-brand-orange border-2 border-brand-orange'
                  : 'bg-secondary/50 dark:bg-secondary/30 text-foreground'
              }`}>
                {idx < currentStepIndex ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>
              <div className="flex flex-col">
                <span className={`text-sm font-medium ${
                  idx <= currentStepIndex ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {step.label}
                </span>
                {step.optional && (
                  <span className="text-[10px] text-muted-foreground">Optional</span>
                )}
              </div>
            </div>
            {idx < steps.length - 1 && (
              <div className={`mx-3 h-0.5 w-8 ${
                idx < currentStepIndex ? 'bg-brand-orange' : 'bg-glass-border'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="glass-panel p-8">
        {/* Step 1: Project Details */}
        {currentStep === 'details' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium mb-1">Project Details</h2>
              <p className="text-sm text-muted-foreground">Basic information about your documentation project</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project Name *</label>
                <input
                  type="text"
                  value={projectData.name}
                  onChange={(e) => setProjectData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Credit Risk Model Documentation"
                  className="input-glass w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={projectData.description}
                  onChange={(e) => setProjectData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of what this project documents..."
                  rows={3}
                  className="input-glass w-full resize-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Code Source */}
        {currentStep === 'source' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium mb-1">Connect Code Source</h2>
              <p className="text-sm text-muted-foreground">Choose how to provide your codebase for analysis</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button
                onClick={() => setProjectData(prev => ({ ...prev, sourceType: 'github', uploadedFiles: [] }))}
                className={`p-6 rounded-xl border-2 text-left transition-all ${
                  projectData.sourceType === 'github'
                    ? 'border-brand-orange bg-brand-orange/5'
                    : 'border-glass-border hover:border-brand-orange/50'
                }`}
              >
                <GitBranch className={`h-8 w-8 mb-3 ${
                  projectData.sourceType === 'github' ? 'text-brand-orange' : 'text-muted-foreground'
                }`} />
                <h3 className="font-medium">GitHub Repository</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect a public or private GitHub repo
                </p>
              </button>

              <button
                onClick={() => setProjectData(prev => ({ ...prev, sourceType: 'upload', repoUrl: '' }))}
                className={`p-6 rounded-xl border-2 text-left transition-all ${
                  projectData.sourceType === 'upload'
                    ? 'border-brand-orange bg-brand-orange/5'
                    : 'border-glass-border hover:border-brand-orange/50'
                }`}
              >
                <Upload className={`h-8 w-8 mb-3 ${
                  projectData.sourceType === 'upload' ? 'text-brand-orange' : 'text-muted-foreground'
                }`} />
                <h3 className="font-medium">Upload Files</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload ZIP archive or individual files
                </p>
              </button>
            </div>

            {/* GitHub Input */}
            {projectData.sourceType === 'github' && (
              <div className="space-y-3">
                <label className="block text-sm font-medium">Repository URL</label>
                <div className="relative">
                  <input
                    type="url"
                    value={projectData.repoUrl}
                    onChange={(e) => {
                      setProjectData(prev => ({ ...prev, repoUrl: e.target.value }));
                      setRepoStatus('idle');
                    }}
                    onBlur={() => validateRepoUrl(projectData.repoUrl)}
                    placeholder="https://github.com/owner/repository"
                    className="input-glass w-full pr-10"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {repoStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {repoStatus === 'valid' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {repoStatus === 'invalid' && <AlertCircle className="h-4 w-4 text-red-500" />}
                  </div>
                </div>
                {repoStatus === 'valid' && (
                  <p className="text-sm text-green-500">Repository found and accessible</p>
                )}
                {repoStatus === 'invalid' && (
                  <p className="text-sm text-red-500">Invalid repository URL. Please check and try again.</p>
                )}
              </div>
            )}

            {/* File Upload */}
            {projectData.sourceType === 'upload' && (
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".zip,.py,.js,.ts,.tsx,.jsx,.md,.json,.yaml,.yml"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleFileDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-glass-border rounded-xl p-8 text-center cursor-pointer hover:border-brand-orange/50 transition-colors"
                >
                  <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-medium">Drop files here or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    ZIP archives, Python, JavaScript, TypeScript, Markdown, JSON, YAML
                  </p>
                </div>

                {projectData.uploadedFiles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Uploaded files:</p>
                    {projectData.uploadedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-glass-bg rounded-lg">
                        <div className="flex items-center gap-3">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{file.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <button 
                          onClick={() => removeFile(idx)}
                          className="p-1 hover:bg-destructive/20 rounded transition-colors"
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Reference Artifacts (Optional) */}
        {currentStep === 'artifacts' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium mb-1">Reference Data <span className="text-muted-foreground font-normal">(Optional)</span></h2>
              <p className="text-sm text-muted-foreground">
                Upload additional files to provide context for documentation generation. 
                These could be model outputs, training metrics, configuration files, etc.
              </p>
            </div>

            <input
              ref={artifactInputRef}
              type="file"
              multiple
              accept=".csv,.json,.yaml,.yml,.pdf,.docx,.xlsx,.png,.jpg,.txt,.md"
              onChange={handleArtifactUpload}
              className="hidden"
            />

            <div
              onClick={() => artifactInputRef.current?.click()}
              onDrop={handleArtifactDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-glass-border rounded-xl p-8 text-center cursor-pointer hover:border-brand-orange/50 transition-colors"
            >
              <Database className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">Drop reference files here or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">
                CSV, JSON, YAML, PDF, DOCX, Excel, Images, Markdown
              </p>
            </div>

            {projectData.artifacts.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Reference files ({projectData.artifacts.length}):</p>
                {projectData.artifacts.map((artifact, idx) => (
                  <div key={idx} className="p-4 bg-glass-bg rounded-lg space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{artifact.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(artifact.file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => removeArtifact(idx)}
                        className="p-1 hover:bg-destructive/20 rounded transition-colors"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                    
                    <div className="flex gap-3">
                      <select
                        value={artifact.type}
                        onChange={(e) => updateArtifact(idx, { type: e.target.value as 'input' | 'output' | 'reference' })}
                        className="input-glass text-sm py-1.5"
                      >
                        <option value="input">Model Input/Training Data</option>
                        <option value="output">Model Output/Results</option>
                        <option value="reference">Reference Document</option>
                      </select>
                    </div>
                    
                    <input
                      type="text"
                      value={artifact.description}
                      onChange={(e) => updateArtifact(idx, { description: e.target.value })}
                      placeholder="Brief description (optional)..."
                      className="input-glass w-full text-sm py-1.5"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 bg-glass-bg rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Tip:</strong> These files help the AI understand your project better. 
                For example, upload <code className="bg-glass-bg-light px-1 rounded">metrics.json</code> to include actual performance numbers in your documentation.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Template Selection */}
        {currentStep === 'template' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium mb-1">Choose a Template</h2>
              <p className="text-sm text-muted-foreground">
                Select a documentation template to structure your output (optional)
              </p>
            </div>

            <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-3 pr-1">
              {templates.length > 0 ? (
                templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => setProjectData(prev => ({ ...prev, templateId: template.id }))}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      projectData.templateId === template.id
                        ? 'border-brand-orange bg-brand-orange/5'
                        : 'border-glass-border hover:border-brand-orange/50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        projectData.templateId === template.id
                          ? 'bg-brand-orange/20'
                          : 'bg-secondary/50 dark:bg-secondary/30'
                      }`}>
                        <LayoutTemplate className={`h-5 w-5 ${
                          projectData.templateId === template.id ? 'text-brand-orange' : 'text-foreground'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-foreground">{template.name}</h3>
                        <p className="text-sm text-muted-foreground">{template.description}</p>
                      </div>
                      {projectData.templateId === template.id && (
                        <CheckCircle2 className="h-5 w-5 text-brand-orange shrink-0" />
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <LayoutTemplate className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No templates available</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setProjectData(prev => ({ ...prev, templateId: '' }))}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                disabled={!projectData.templateId}
              >
                Clear selection
              </button>
              <Link
                href="/templates/new"
                className="text-sm text-brand-orange hover:underline flex items-center gap-1"
              >
                <Plus className="h-4 w-4" />
                Create new template
              </Link>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {currentStep === 'review' && (() => {
          const hasSource = projectData.sourceType === 'github' || projectData.uploadedFiles.length > 0;
          const hasTemplate = !!projectData.templateId;
          const selectedTemplate = getTemplate(projectData.templateId);
          
          return (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-medium mb-1">Review & Create</h2>
                <p className="text-sm text-muted-foreground">Review your project settings before creating</p>
              </div>

              <div className="space-y-4">
              <div className="p-4 bg-glass-bg rounded-lg">
                <p className="text-xs text-muted-foreground uppercase mb-1">Project Name</p>
                <p className="font-medium">{projectData.name}</p>
              </div>

              {projectData.description && (
                <div className="p-4 bg-glass-bg rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase mb-1">Description</p>
                  <p className="text-sm">{projectData.description}</p>
                </div>
              )}

              <div className="p-4 bg-glass-bg rounded-lg">
                <p className="text-xs text-muted-foreground uppercase mb-1">Code Source</p>
                <div className="flex items-center gap-2">
                  {projectData.sourceType === 'github' ? (
                    <>
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{projectData.repoUrl}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{projectData.uploadedFiles.length} file(s) uploaded</span>
                    </>
                  )}
                </div>
              </div>

              {projectData.artifacts.length > 0 && (
                <div className="p-4 bg-glass-bg rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase mb-1">Reference Files</p>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{projectData.artifacts.length} file(s)</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {projectData.artifacts.map((a, idx) => (
                      <span key={idx} className="text-xs bg-glass-bg-light px-2 py-1 rounded">
                        {a.file.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 bg-glass-bg rounded-lg">
                <p className="text-xs text-muted-foreground uppercase mb-1">Template</p>
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {getTemplate(projectData.templateId)?.name || 'No template selected'}
                  </span>
                </div>
              </div>
              </div>

              {/* Dynamic next steps based on selections */}
              <div className="space-y-3">
                {hasTemplate && selectedTemplate && (
                  <div className="p-4 border border-brand-orange/50 bg-brand-orange/5 rounded-lg">
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-5 w-5 text-brand-orange shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">What happens next</p>
                        <p className="text-sm text-muted-foreground">
                          We'll analyze your {projectData.sourceType === 'github' ? 'GitHub repository' : 'uploaded files'}, build a knowledge graph with semantic embeddings, and generate documentation using the <strong>{selectedTemplate.name}</strong> template. This typically takes 5-15 minutes depending on repository size.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                {!hasTemplate && (
                  <div className="p-4 border border-green-500/50 bg-green-500/5 rounded-lg">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">Project created instantly</p>
                        <p className="text-sm text-muted-foreground">
                          Your project will be created and you'll be taken to the project page. From there you can:
                        </p>
                        <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
                          <li>View the <strong>Knowledge Graph</strong> to explore your codebase (analysis runs on demand)</li>
                          <li>Generate documentation by selecting a template</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between mt-8 pt-6 border-t border-glass-border">
        <button
          onClick={prevStep}
          disabled={currentStepIndex === 0}
          className="btn-secondary disabled:opacity-50"
        >
          Back
        </button>

        {currentStep === 'review' ? (
          <button
            onClick={handleCreate}
            disabled={isLoading}
            className="btn-primary"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                {projectData.templateId 
                  ? 'Create Project & Generate Documentation'
                  : 'Create Project'
                }
              </>
            )}
          </button>
        ) : (
          <button
            onClick={nextStep}
            disabled={!canProceed()}
            className="btn-primary disabled:opacity-50"
          >
            Continue
          </button>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}

