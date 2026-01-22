'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import {
  GitBranch,
  FileText,
  Upload,
  Play,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  FolderTree,
  X,
  LayoutTemplate,
  AlertTriangle,
  Edit,
  Trash2,
  Save,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import { useProjectsStore, selectProject, selectProjectRuns, type Project } from '@/store/projects';
import { useTemplatesStore, flattenTemplateBlocks } from '@/store/templates';
import { generateDocument, isOpenAIConfigured, getOpenAIErrorMessage, type GenerationContext, type ThinkingStep } from '@/lib/openai';
import { notificationService } from '@/lib/notifications';
import { toast } from 'sonner';

export default function ProjectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = params.id as string;
  
  const [activeTab, setActiveTab] = useState<'overview' | 'artifacts' | 'runs'>('overview');
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Get project from store using optimized selectors
  const storeProject = useProjectsStore(selectProject(projectId));
  const projectRuns = useProjectsStore(selectProjectRuns(projectId));
  const addRun = useProjectsStore((state) => state.addRun);
  const updateRun = useProjectsStore((state) => state.updateRun);
  const deleteRun = useProjectsStore((state) => state.deleteRun);
  const updateProject = useProjectsStore((state) => state.updateProject);
  const deleteProject = useProjectsStore((state) => state.deleteProject);
  
  // Cache update function for document generation
  const updateProjectCache = useCallback((updates: {
    lastCommitHash?: string;
    cachedKnowledgeBase?: any;
    cachedCodeIntelligence?: any;
    nodeSummaries?: Record<string, string>;
  }) => {
    updateProject(projectId, {
      lastCommitHash: updates.lastCommitHash,
      nodeSummaries: updates.nodeSummaries,
      lastKnowledgeGraphUpdate: new Date(),
    });
  }, [projectId, updateProject]);

  // Get templates from store
  const templates = useTemplatesStore((state) => state.templates);
  const getTemplate = useTemplatesStore((state) => state.getTemplate);

  // Use store project or show "not found" state
  const project: Project | null = storeProject || null;

  // Check if we should auto-start generation (from project creation flow)
  // If template is already selected, go directly to generating
  useEffect(() => {
    if (searchParams.get('generate') === 'true' && project) {
      // Pre-select the template used during project creation
      if (project.templateId) {
        setSelectedTemplate(project.templateId);
      }
      // Show dialog (will show ready state if template pre-selected)
      setShowGenerateDialog(true);
    }
  }, [searchParams, project]);

  // If project not found, show error
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <AlertCircle className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Project Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The project you're looking for doesn't exist or has been deleted.
        </p>
        <Link href="/projects" className="btn-primary">
          Back to Projects
        </Link>
      </div>
    );
  }

  // Build artifacts list from uploaded files
  const artifacts = project.uploadedFileNames?.map((name, idx) => ({
    id: `artifact-${idx}`,
    name,
    size: 'Unknown',
    type: name.split('.').pop() || 'file',
  })) || [];

  const [generationMessage, setGenerationMessage] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!selectedTemplate) return;
    
    console.log('[UI] Starting generation for template:', selectedTemplate);
    
    // Get actual template from store
    const template = getTemplate(selectedTemplate);
    if (!template) {
      console.error('[UI] Template not found:', selectedTemplate);
      return;
    }
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationError(null);
    setGenerationMessage('Initializing...');

    // Count total blocks for progress info
    const totalBlocks = flattenTemplateBlocks(template).length;
    console.log('[UI] Template has', totalBlocks, 'blocks to generate');

    // Create a new run in the store
    const runId = addRun({
      projectId,
      templateId: selectedTemplate,
      templateName: template.name,
      status: 'RUNNING',
    });

    // Request notification permission and start tracking this generation
    await notificationService.requestPermission();
    notificationService.startTracking(runId, projectId, project.name, template.name);

    try {
      console.log('[UI] Checking OpenAI configuration...');
      
      if (!isOpenAIConfigured()) {
        throw new Error(getOpenAIErrorMessage());
      }

      // Clear previous thinking steps
      setThinkingSteps([]);
      
      // Build generation context with actual template
      const context: GenerationContext = {
        projectName: project.name,
        projectDescription: project.description,
        repoUrl: project.repoUrl,
        template, // Pass actual template structure
        artifacts: project.artifacts?.map(a => ({
          name: a.name,
          type: a.type,
          description: a.description,
        })),
        nodeSummaries: project.nodeSummaries,
        // Callback to receive thinking steps for UI display
        onThinking: (step: ThinkingStep) => {
          setThinkingSteps(prev => {
            // Keep only the last 10 steps to avoid memory bloat
            const newSteps = [...prev, step];
            return newSteps.slice(-10);
          });
        },
      };

      console.log('[UI] Calling generateDocument with context:', {
        projectName: context.projectName,
        repoUrl: context.repoUrl,
        templateName: template.name,
      });

      // Navigate to document page immediately so user can see sections as they stream in
      console.log('[UI] Navigating to document page for real-time updates');
      router.push(`/projects/${projectId}/runs/${runId}`);

      // Call real OpenAI generation with timeout and caching
      const generationPromise = generateDocument(
        context,
        (progress, message) => {
          console.log('[UI] Progress update:', progress, message);
          setGenerationProgress(progress);
          setGenerationMessage(message);
          updateRun(runId, { progress: Math.round(progress) });
        },
        (section) => {
          // Stream completed sections to UI in real-time
          console.log('[UI] Section completed, streaming to document:', section.title);

          // Get current run state
          const currentState = useProjectsStore.getState();
          const currentProject = currentState.projects.find(p => p.id === projectId);
          const currentRun = currentProject?.runs.find(r => r.id === runId);

          if (currentRun) {
            // Append new section to existing sections
            const updatedSections = [...(currentRun.sections || []), section];

            updateRun(runId, {
              sections: updatedSections,
              progress: Math.round(15 + (updatedSections.length / template.sections.length) * 70),
            });

            console.log(`[UI] ✅ Section "${section.title}" streamed to UI (${updatedSections.length}/${template.sections.length} sections complete)`);
          }
        },
        {
          lastCommitHash: project.lastCommitHash,
          cachedKnowledgeBase: project.cachedKnowledgeBase,
          cachedCodeIntelligence: project.cachedCodeIntelligence,
          updateCache: updateProjectCache,
        }
      );

      // Add overall timeout (extended for full-repo, evidence-first runs)
      const timeoutMinutes = 20;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Generation timed out after ${timeoutMinutes} minutes. ` +
                  'Your repo is large and evidence-first analysis can take longer.'
              )
            ),
          timeoutMinutes * 60 * 1000
        )
      );

      const result = await Promise.race([generationPromise, timeoutPromise]);

      console.log('[UI] Generation complete, updating run...');

      // Update run with generated content
      updateRun(runId, {
        documentTitle: result.documentTitle,
        sections: result.sections,
        gaps: result.gaps,
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date(),
        qualityMetrics: result.qualityMetrics,
      });

      setGenerationProgress(100);
      setGenerationMessage('Complete!');

      // Stop tracking (notification will be shown by the service)
      notificationService.stopTracking(runId);

      // Show toast notification (user is already on the document page)
      toast.success('Document generation complete!', {
        description: `${template.name} is ready to view`,
        duration: 5000,
      });

      // No need to navigate - user is already viewing the document with real-time updates
      
    } catch (error) {
      console.error('[UI] Generation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setGenerationError(errorMessage);
      updateRun(runId, { 
        status: 'FAILED',
        progress: 0,
      });
      
      // Stop tracking (notification will be shown by the service)
      notificationService.stopTracking(runId);
      
      // Show toast notification
      toast.error('Document generation failed', {
        description: errorMessage,
        duration: 10000,
      });
      
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-start justify-between shrink-0 mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Link href="/projects" className="hover:text-foreground">
              Projects
            </Link>
            <ChevronRight className="h-4 w-4" />
            <span>{project.name}</span>
          </div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {project.description || 'No description provided'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setEditName(project.name);
              setEditDescription(project.description || '');
              setShowEditDialog(true);
            }}
            className="btn-ghost"
            title="Edit project"
          >
            <Edit className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="btn-ghost text-red-400 hover:text-red-500 hover:bg-red-500/10"
            title="Delete project"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <Link
            href={`/templates`}
            className="btn-secondary"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Template
          </Link>
          <button 
            onClick={() => setShowGenerateDialog(true)}
            className="btn-primary"
            disabled={project.repoStatus !== 'READY'}
          >
            {project.repoStatus !== 'READY' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {project.repoStatus === 'READY' ? 'Generate Doc' : 'Indexing...'}
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4 shrink-0 mb-6">
        <StatCard
          icon={<GitBranch className="h-5 w-5" />}
          label="Repository"
          value={project.repoStatus}
          status={
            project.repoStatus === 'READY' ? 'success' : 
            project.repoStatus === 'ERROR' ? 'error' : 'pending'
          }
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Template"
          value={project.templateName}
        />
        <StatCard
          icon={<Upload className="h-5 w-5" />}
          label="Artifacts"
          value={artifacts.length.toString()}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Last Updated"
          value={formatRelativeTime(project.updatedAt)}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-glass-border shrink-0 mb-4">
        <div className="flex gap-6">
          {(['overview', 'artifacts', 'runs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-brand-orange text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Repository Section */}
          <div className="glass-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">
                {project.sourceType === 'github' ? 'Repository' : 'Uploaded Files'}
              </h2>
              {project.sourceType === 'github' && project.repoStatus === 'READY' && (
                <div className="flex items-center gap-3">
                  {project.lastKnowledgeGraphUpdate && (
                    <span className="text-xs text-muted-foreground">
                      Cached: {formatRelativeTime(project.lastKnowledgeGraphUpdate)}
                    </span>
                  )}
                  <Link
                    href={`/projects/${projectId}/knowledge-graph`}
                    className="text-sm text-brand-orange hover:underline"
                  >
                    View Knowledge Graph
                  </Link>
                </div>
              )}
            </div>
            
            {project.sourceType === 'github' && project.repoUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={project.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-orange hover:underline"
                  >
                    {project.repoUrl.replace('https://github.com/', '')}
                  </a>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {project.repoStatus === 'READY' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span>Indexed and ready</span>
                      {project.lastKnowledgeGraphUpdate && (
                        <span className="text-xs">• Cached {formatRelativeTime(project.lastKnowledgeGraphUpdate)}</span>
                      )}
                    </>
                  ) : project.repoStatus === 'CLONING' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />
                      <span>Cloning repository...</span>
                    </>
                  ) : project.repoStatus === 'INDEXING' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />
                      <span>Building knowledge graph...</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <span>Error processing repository</span>
                    </>
                  )}
                </div>
              </div>
            ) : project.sourceType === 'upload' ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground mb-2">
                  {artifacts.length} file(s) uploaded
                </p>
                {artifacts.slice(0, 3).map((artifact) => (
                  <div key={artifact.id} className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{artifact.name}</span>
                  </div>
                ))}
                {artifacts.length > 3 && (
                  <button 
                    onClick={() => setActiveTab('artifacts')}
                    className="text-xs text-brand-orange hover:underline"
                  >
                    +{artifacts.length - 3} more files
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <GitBranch className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  No source connected
                </p>
              </div>
            )}
          </div>

          {/* Templates Section */}
          <div className="glass-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Available Templates</h2>
              <Link
                href={`/templates`}
                className="text-sm text-brand-orange hover:underline"
              >
                Browse Templates
              </Link>
            </div>
            
            {/* Scrollable template list - shows ~5 items, scrollable for more */}
            <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-2 pr-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between rounded-lg bg-glass-bg p-3 transition-colors hover:bg-glass-bg-light"
                >
                  <div className="flex items-center gap-3">
                    <FolderTree className="h-4 w-4 text-brand-orange" />
                    <span className="text-sm font-medium">{template.name}</span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedTemplate(template.id);
                      setShowGenerateDialog(true);
                    }}
                    disabled={project.repoStatus !== 'READY'}
                    className="text-xs text-brand-orange hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Generate →
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Runs */}
          <div className="glass-card lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Recent Generation Runs</h2>
              {projectRuns.length > 0 && (
                <button
                  onClick={() => setActiveTab('runs')}
                  className="text-sm text-brand-orange hover:underline"
                >
                  View All
                </button>
              )}
            </div>
            
            {projectRuns.length > 0 ? (
              <div className="space-y-3">
                {projectRuns.slice(0, 5).map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-lg bg-glass-bg p-4 transition-colors hover:bg-glass-bg-light group"
                  >
                    <Link
                      href={`/projects/${projectId}/runs/${run.id}`}
                      className="flex items-center gap-4 flex-1"
                    >
                      <StatusIcon status={run.status} />
                      <div>
                        <p className="font-medium">{run.templateName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelativeTime(run.createdAt)}
                        </p>
                      </div>
                    </Link>
                    
                    <div className="flex items-center gap-3">
                      {run.status === 'RUNNING' && (
                        <>
                          <div className="h-2 w-24 rounded-full bg-glass-bg-heavy">
                            <div
                              className="h-full rounded-full bg-brand-orange transition-all"
                              style={{ width: `${run.progress}%` }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {run.progress}%
                          </span>
                        </>
                      )}
                      
                      {run.status === 'COMPLETED' && (
                        <span className="text-sm text-green-500">Completed</span>
                      )}
                      
                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (confirm('Delete this run? This cannot be undone.')) {
                            deleteRun(run.id);
                          }
                        }}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all"
                        title="Delete run"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Play className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No generation runs yet. Click "Generate Doc" to create your first document.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'artifacts' && (
        <div className="glass-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Uploaded Artifacts</h2>
            <button className="btn-secondary text-sm" onClick={() => alert('File upload coming soon!')}>
              <Upload className="mr-2 h-4 w-4" />
              Upload File
            </button>
          </div>
          
          {artifacts.length > 0 ? (
            <div className="space-y-2">
              {artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-center justify-between rounded-lg bg-glass-bg p-3"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{artifact.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground uppercase">
                    {artifact.type}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No artifacts uploaded yet
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'runs' && (
        <div className="glass-card">
          <h2 className="mb-4 font-semibold">All Generation Runs</h2>
          {projectRuns.length > 0 ? (
            <div className="space-y-3">
              {projectRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-lg bg-glass-bg p-4 transition-colors hover:bg-glass-bg-light group"
                >
                  <Link
                    href={`/projects/${projectId}/runs/${run.id}`}
                    className="flex items-center gap-4 flex-1"
                  >
                    <StatusIcon status={run.status} />
                    <div>
                      <p className="font-medium">{run.templateName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(run.createdAt)}
                      </p>
                    </div>
                  </Link>
                  
                  <div className="flex items-center gap-3">
                    <span className={`text-sm ${
                      run.status === 'COMPLETED' ? 'text-green-500' : 
                      run.status === 'RUNNING' ? 'text-brand-orange' : 
                      'text-muted-foreground'
                    }`}>
                      {run.status.toLowerCase()}
                    </span>
                    
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        if (confirm('Delete this run? This cannot be undone.')) {
                          deleteRun(run.id);
                        }
                      }}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all"
                      title="Delete run"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Play className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No generation runs yet
              </p>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Generate Document Dialog */}
      {showGenerateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40 backdrop-blur-md">
          <div className="glass-panel relative w-full max-w-md p-6 mx-4 shadow-2xl border border-glass-border/50 bg-gradient-to-br from-glass-bg/95 via-glass-bg/90 to-glass-bg/85 dark:from-glass-bg/95 dark:via-glass-bg/90 dark:to-brand-orange/5 light:from-white/95 light:via-white/92 light:to-white/88">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Generate Documentation</h2>
              <button 
                onClick={() => {
                  // Don't reset generation state - let it continue in background
                  if (!isGenerating) {
                    setShowGenerateDialog(false);
                    setSelectedTemplate('');
                  } else {
                    // If generating, just close the dialog but keep generation running
                    setShowGenerateDialog(false);
                  }
                }}
                className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
                title={isGenerating ? "Generation is running in the background. Check notifications for updates." : "Close"}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!isGenerating ? (
              <>
                {/* If template was pre-selected (from project creation), show ready state */}
                {selectedTemplate && searchParams.get('generate') === 'true' ? (
                  <>
                    <div className="text-center py-4 mb-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-orange/10 mx-auto mb-4">
                        <CheckCircle2 className="h-8 w-8 text-brand-orange" />
                      </div>
                      <h3 className="font-medium text-lg mb-1">Ready to Generate</h3>
                      <p className="text-sm text-muted-foreground">
                        Your project is set up with the <strong>{project.templateName}</strong> template.
                      </p>
                    </div>

                    <div className="p-4 bg-glass-bg rounded-lg mb-6 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Project</span>
                        <span className="font-medium">{project.name}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Source</span>
                        <span className="font-medium">
                          {project.sourceType === 'github' 
                            ? project.repoUrl?.split('/').slice(-2).join('/') 
                            : `${project.uploadedFileNames?.length || 0} files`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Template</span>
                        <span className="font-medium">{project.templateName}</span>
                      </div>
                      {project.artifacts.length > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Reference Files</span>
                          <span className="font-medium">{project.artifacts.length} files</span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleGenerate}
                      className="btn-primary w-full"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Start Generation
                    </button>
                  </>
                ) : (
                  <>
                  <p className="text-muted-foreground mb-4">
                    Select a template to generate documentation:
                  </p>
                  {!isOpenAIConfigured() && (
                    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
                        <div>
                          <p className="font-medium">OpenAI API key not loaded</p>
                          <p className="text-xs text-red-200/80">
                            Create `.env.local` in the project root with `NEXT_PUBLIC_OPENAI_API_KEY`,
                            then restart the dev server.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {generationError && (
                    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
                        <div>
                          <p className="font-medium">Generation failed</p>
                          <p className="whitespace-pre-line text-xs text-red-200/80">
                            {generationError}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                    {/* Scrollable template list - shows ~5 items, scrollable for more */}
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-2 mb-6 pr-2">
                      {templates.map((template) => {
                        const blocksCount = flattenTemplateBlocks(template).length;
                        return (
                          <button
                            key={template.id}
                            onClick={() => setSelectedTemplate(template.id)}
                            className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                              selectedTemplate === template.id
                                ? 'border-brand-orange bg-brand-orange/5'
                                : 'border-glass-border hover:border-brand-orange/50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <LayoutTemplate className={`h-5 w-5 ${
                                selectedTemplate === template.id ? 'text-brand-orange' : 'text-muted-foreground'
                              }`} />
                              <div>
                                <p className="font-medium">{template.name}</p>
                                <p className="text-xs text-muted-foreground">{blocksCount} content blocks</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowGenerateDialog(false)}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleGenerate}
                        disabled={!selectedTemplate}
                        className="btn-primary flex-1 disabled:opacity-50"
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Generate
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : generationError ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <h3 className="font-medium mb-2 text-red-500">Generation Failed</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {generationError}
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => {
                      setGenerationError(null);
                      setIsGenerating(false);
                    }}
                    className="btn-secondary"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => {
                      setShowGenerateDialog(false);
                      setGenerationError(null);
                      setIsGenerating(false);
                    }}
                    className="btn-ghost"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-6">
                <div className="text-center mb-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-orange/10 ring-1 ring-brand-orange/20 shadow-lg shadow-brand-orange/20">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-orange" />
                  </div>
                  <h3 className="font-medium mb-2">Generating Documentation...</h3>
                  <p className="text-sm text-muted-foreground">
                    {generationMessage || 'Connecting to AI...'}
                  </p>
                </div>
                
                {/* Progress bar */}
                <div className="mb-4">
                  <div className="w-full h-2 bg-glass-bg rounded-full overflow-hidden border border-glass-border/70">
                    <div 
                      className="h-full bg-brand-orange/80 transition-all duration-300"
                      style={{ width: `${Math.min(generationProgress, 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 text-center">
                    {Math.round(Math.min(generationProgress, 100))}% complete
                  </p>
                </div>
                
                {/* Agent Thinking Steps */}
                {thinkingSteps.length > 0 && (
                  <div className="mt-4 rounded-lg overflow-hidden border border-border/50 dark:border-white/10 bg-muted/30 dark:bg-black/20">
                    <div className="px-3 py-2 border-b border-border/50 dark:border-white/10 bg-muted/50 dark:bg-black/30">
                      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        🤖 Agent Thinking
                      </h4>
                    </div>
                    <div className="max-h-40 overflow-y-auto p-3 space-y-2">
                      {thinkingSteps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs animate-in fade-in slide-in-from-bottom-1 duration-300">
                          <span className="flex-shrink-0 w-5 text-center">
                            {step.type === 'think' && '💭'}
                            {step.type === 'search' && '🔍'}
                            {step.type === 'observe' && '👀'}
                            {step.type === 'draft' && '✍️'}
                            {step.type === 'verify' && '✅'}
                            {step.type === 'refine' && '🔄'}
                            {step.type === 'tool' && '🛠️'}
                            {step.type === 'complete' && '🎉'}
                            {step.type === 'evidence' && '📚'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground dark:text-white/90 truncate">{step.message}</p>
                            {step.details && (
                              <p className="text-muted-foreground dark:text-white/50 truncate mt-0.5">{step.details}</p>
                            )}
                          </div>
                          {step.iteration && step.iteration > 0 && (
                            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-brand-orange/10 dark:bg-brand-orange/20 text-brand-orange">
                              #{step.iteration}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <p className="text-xs text-muted-foreground mt-4 text-center">
                  You can close this dialog while generation continues in the background.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Project Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40 backdrop-blur-md">
          <div className="glass-panel w-full max-w-md p-6 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Edit Project</h2>
              <button 
                onClick={() => {
                  setShowEditDialog(false);
                  setEditName('');
                  setEditDescription('');
                }}
                className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter project name"
                  className="input-glass w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Enter project description"
                  rows={3}
                  className="input-glass w-full resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowEditDialog(false);
                    setEditName('');
                    setEditDescription('');
                  }}
                  className="btn-ghost flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (editName.trim()) {
                      updateProject(projectId, {
                        name: editName.trim(),
                        description: editDescription.trim() || undefined,
                      });
                      setShowEditDialog(false);
                      setEditName('');
                      setEditDescription('');
                    }
                  }}
                  disabled={!editName.trim()}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40 backdrop-blur-md">
          <div className="glass-panel w-full max-w-md p-6 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-red-400">Delete Project</h2>
              <button 
                onClick={() => setShowDeleteDialog(false)}
                className="p-2 hover:bg-glass-bg rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-red-400 mb-1">Warning: This action cannot be undone</p>
                  <p className="text-sm text-muted-foreground">
                    Deleting this project will also delete all associated generation runs and documents.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-glass-bg">
                <p className="text-sm font-medium mb-2">Project: {project.name}</p>
                <p className="text-xs text-muted-foreground">
                  {projectRuns.length} generation run{projectRuns.length !== 1 ? 's' : ''} will be deleted
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowDeleteDialog(false)}
                  className="btn-ghost flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteProject(projectId);
                    router.push('/projects');
                  }}
                  className="btn-primary flex-1 bg-red-500 hover:bg-red-600"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: 'success' | 'pending' | 'error';
}) {
  return (
    <div className="glass-card flex items-center gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-glass-bg-light text-brand-orange">
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`font-semibold ${
          status === 'success' ? 'text-green-500' :
          status === 'error' ? 'text-red-500' :
          ''
        }`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'RUNNING':
      return <Loader2 className="h-5 w-5 animate-spin text-brand-orange" />;
    case 'FAILED':
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}
