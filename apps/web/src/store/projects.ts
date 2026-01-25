import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Artifact {
  id: string;
  name: string;
  type: 'input' | 'output' | 'reference';
  fileType: string;
  size: number;
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  sourceType: 'github' | 'upload';
  repoUrl?: string;
  uploadedFileNames?: string[];
  templateId: string;
  templateName: string;
  repoStatus: 'PENDING' | 'CLONING' | 'INDEXING' | 'READY' | 'ERROR';
  createdAt: Date;
  updatedAt: Date;
  documentsCount: number;
  artifactsCount: number;
  // Reference artifacts for generation
  artifacts: Artifact[];
  // Cached repository data
  lastCommitHash?: string;
  lastKnowledgeGraphUpdate?: Date;
  cachedKnowledgeBase?: any; // CodeKnowledgeBase (stored as JSON)
  cachedCodeIntelligence?: any; // CodeIntelligenceResult (stored as JSON, without functions)
  // Node summaries from evidence-first generation (filePath -> summary)
  nodeSummaries?: Record<string, string>; // Map serialized as object
}

export interface GeneratedSection {
  id: string;
  title: string;
  blocks: GeneratedBlock[];
  subsections?: GeneratedSection[];
}

export interface GeneratedBlock {
  id: string;
  type: 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART' | 'STATIC_TEXT';
  title: string;
  content: string;
  confidence: number;
  citations: string[];
  // RAG explainability (audit evidence)
  ragSources?: Array<{
    filePath: string;
    lineRange?: { start: number; end: number };
    tier: 1 | 2;
    category?: string;
    excerpt?: string;
    reason?: string;
  }>;
  dataEvidence?: Array<{
    filePath: string;
    rowCount: number;
    columns: Array<{ name: string; dtype: string; nullPercent: number; min?: string; max?: string }>;
  }>;
  // For LLM_CHART blocks with code execution
  generatedImage?: {
    base64: string;
    mimeType: string;
    description?: string;
  }; // Backward compatibility - last chart
  generatedImages?: Array<{
    base64: string;
    mimeType: string;
    description?: string;
  }>; // New: array of all charts
  executedCode?: string; // The Python code that was run
}

export interface DocumentGap {
  id: string;
  sectionId: string;
  sectionTitle: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface GenerationRun {
  id: string;
  projectId: string;
  templateId: string;
  templateName: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  statusMessage?: string; // Current generation status for UI display
  createdAt: Date;
  completedAt?: Date;
  // Generated content
  documentTitle?: string;
  sections?: GeneratedSection[];
  gaps?: DocumentGap[];
  // Chat history
  chatMessages?: ChatMessage[];
  // Section ordering - ensures consistent section display during concurrent generation
  sectionOrder?: string[]; // Array of section IDs in template order
  // Evidence quality metrics
  qualityMetrics?: {
    tier1CitationPercent: number;
    tier1SectionCoverage: number;
    executedValidationsCount: number;
    uncoveredSectionsCount: number;
    readmeOnlyCount: number;
    totalCitations: number;
    tier1Citations: number;
    tier2Citations: number;
  };
}

interface ProjectsState {
  projects: Project[];
  runs: GenerationRun[];
  
  // Project Actions
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'documentsCount' | 'artifactsCount' | 'repoStatus' | 'artifacts'> & { artifacts?: Artifact[] }) => string;
  getProject: (id: string) => Project | undefined;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  addArtifact: (projectId: string, artifact: Omit<Artifact, 'id'>) => void;
  removeArtifact: (projectId: string, artifactId: string) => void;
  
  // Run Actions
  addRun: (run: Omit<GenerationRun, 'id' | 'createdAt' | 'progress'>) => string;
  getRun: (id: string) => GenerationRun | undefined;
  getProjectRuns: (projectId: string) => GenerationRun[];
  updateRun: (id: string, updates: Partial<GenerationRun>) => void;
  deleteRun: (id: string) => void;
  
  // Content generation helper
  generateDocumentContent: (projectId: string, runId: string, templateId: string) => void;
}

// Template name lookup
const templateNames: Record<string, string> = {
  'tpl-1': 'Model Documentation',
  'tpl-2': 'API Technical Spec',
  'tpl-3': 'Model Validation Report',
};

// Helper to generate contextual document content based on project
function generateMockContent(project: Project, templateId: string): { title: string; sections: GeneratedSection[] } {
  const repoName = project.repoUrl?.split('/').slice(-2).join('/') || project.name;
  const isModelDoc = templateId === 'tpl-1';
  const isApiDoc = templateId === 'tpl-2';
  const isValidationDoc = templateId === 'tpl-3';
  
  if (isModelDoc) {
    return {
      title: `${project.name} - Model Documentation`,
      sections: [
        {
          id: 'sec-1',
          title: 'Executive Summary',
          blocks: [
            {
              id: 'blk-1',
              type: 'LLM_TEXT',
              title: 'Model Overview',
              content: `# Model Overview\n\nThis document provides comprehensive documentation for the **${project.name}** project, sourced from the repository \`${repoName}\`.\n\n## Purpose\n\nThis model is designed to [describe primary function based on repository analysis]. The implementation follows industry best practices and includes comprehensive testing and validation procedures.\n\n## Key Features\n\n- Feature extraction and preprocessing pipeline\n- Model training and evaluation framework\n- Production-ready inference API\n- Comprehensive logging and monitoring`,
              confidence: 0.92,
              citations: [`${repoName}/README.md:1-15`, `${repoName}/src/model.py:1-50`],
            },
          ],
        },
        {
          id: 'sec-2',
          title: 'Model Architecture',
          blocks: [
            {
              id: 'blk-2',
              type: 'LLM_TEXT',
              title: 'Architecture Description',
              content: `## Architecture\n\nThe model architecture consists of the following components:\n\n### Input Layer\nAccepts preprocessed feature vectors of dimension N, where features include both numerical and categorical variables.\n\n### Hidden Layers\nMultiple fully-connected layers with ReLU activation functions and dropout regularization.\n\n### Output Layer\nFinal classification/regression layer appropriate for the target task.\n\n### Key Implementation Details\n- Framework: Python with scikit-learn/PyTorch\n- Training: Batch gradient descent with Adam optimizer\n- Regularization: L2 weight decay, dropout`,
              confidence: 0.87,
              citations: [`${repoName}/src/model.py:25-80`, `${repoName}/config/model_config.yaml`],
            },
            {
              id: 'blk-3',
              type: 'LLM_TABLE',
              title: 'Model Parameters',
              content: JSON.stringify({
                headers: ['Parameter', 'Value', 'Description'],
                rows: [
                  ['Learning Rate', '0.001', 'Initial learning rate for Adam optimizer'],
                  ['Batch Size', '32', 'Number of samples per training batch'],
                  ['Epochs', '100', 'Maximum training epochs'],
                  ['Dropout', '0.3', 'Dropout probability for regularization'],
                  ['Hidden Units', '[128, 64, 32]', 'Units in each hidden layer'],
                ],
              }),
              confidence: 0.94,
              citations: [`${repoName}/config/model_config.yaml`],
            },
          ],
        },
        {
          id: 'sec-3',
          title: 'Data Requirements',
          blocks: [
            {
              id: 'blk-4',
              type: 'LLM_TEXT',
              title: 'Input Data Schema',
              content: `## Data Requirements\n\n### Input Features\n\nThe model expects the following input features:\n\n| Feature | Type | Description |\n|---------|------|-------------|\n| feature_1 | float | Primary numerical feature |\n| feature_2 | float | Secondary numerical feature |\n| category_1 | string | Categorical variable A |\n| category_2 | string | Categorical variable B |\n\n### Data Quality Requirements\n\n- No missing values in required fields\n- Numerical features should be normalized\n- Categorical features should be encoded`,
              confidence: 0.89,
              citations: [`${repoName}/src/data_loader.py:10-45`],
            },
          ],
        },
      ],
    };
  } else if (isApiDoc) {
    return {
      title: `${project.name} - API Documentation`,
      sections: [
        {
          id: 'sec-1',
          title: 'API Overview',
          blocks: [
            {
              id: 'blk-1',
              type: 'LLM_TEXT',
              title: 'Introduction',
              content: `# API Documentation\n\n## Overview\n\nThis document describes the REST API for **${project.name}** (${repoName}).\n\n## Base URL\n\n\`\`\`\nhttps://api.example.com/v1\n\`\`\`\n\n## Authentication\n\nAll API requests require a valid API key passed in the \`Authorization\` header:\n\n\`\`\`\nAuthorization: Bearer <your-api-key>\n\`\`\``,
              confidence: 0.91,
              citations: [`${repoName}/src/routes/index.ts:1-30`],
            },
          ],
        },
        {
          id: 'sec-2',
          title: 'Endpoints',
          blocks: [
            {
              id: 'blk-2',
              type: 'LLM_TABLE',
              title: 'Available Endpoints',
              content: JSON.stringify({
                headers: ['Method', 'Endpoint', 'Description'],
                rows: [
                  ['GET', '/health', 'Health check endpoint'],
                  ['POST', '/predict', 'Run model prediction'],
                  ['GET', '/models', 'List available models'],
                  ['GET', '/models/:id', 'Get model details'],
                ],
              }),
              confidence: 0.95,
              citations: [`${repoName}/src/routes/`],
            },
          ],
        },
      ],
    };
  } else {
    return {
      title: `${project.name} - Validation Report`,
      sections: [
        {
          id: 'sec-1',
          title: 'Validation Summary',
          blocks: [
            {
              id: 'blk-1',
              type: 'LLM_TEXT',
              title: 'Executive Summary',
              content: `# Validation Report\n\n## Summary\n\nThis report documents the validation results for **${project.name}** (${repoName}).\n\n## Validation Scope\n\n- Model accuracy and performance metrics\n- Data quality assessment\n- Bias and fairness analysis\n- Robustness testing\n\n## Overall Assessment\n\nThe model meets the required performance thresholds and is approved for production deployment.`,
              confidence: 0.88,
              citations: [`${repoName}/tests/validation/`],
            },
          ],
        },
        {
          id: 'sec-2',
          title: 'Performance Metrics',
          blocks: [
            {
              id: 'blk-2',
              type: 'LLM_TABLE',
              title: 'Key Metrics',
              content: JSON.stringify({
                headers: ['Metric', 'Value', 'Threshold', 'Status'],
                rows: [
                  ['Accuracy', '0.94', '> 0.90', '✓ Pass'],
                  ['Precision', '0.92', '> 0.85', '✓ Pass'],
                  ['Recall', '0.89', '> 0.80', '✓ Pass'],
                  ['F1 Score', '0.90', '> 0.85', '✓ Pass'],
                  ['AUC-ROC', '0.96', '> 0.90', '✓ Pass'],
                ],
              }),
              confidence: 0.96,
              citations: [`${repoName}/results/metrics.json`],
            },
          ],
        },
      ],
    };
  }
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      runs: [],

      addProject: (projectData) => {
        const id = `proj-${Date.now()}`;
        const now = new Date();
        
        const newProject: Project = {
          ...projectData,
          id,
          templateName: templateNames[projectData.templateId] || projectData.templateName || 'Unknown Template',
          repoStatus: projectData.sourceType === 'github' ? 'CLONING' : 'READY',
          createdAt: now,
          updatedAt: now,
          documentsCount: 0,
          artifactsCount: (projectData.artifacts?.length || 0) + (projectData.uploadedFileNames?.length || 0),
          artifacts: projectData.artifacts || [],
        };

        set((state) => ({
          projects: [...state.projects, newProject],
        }));

        // Simulate repo indexing for GitHub projects
        if (projectData.sourceType === 'github') {
          setTimeout(() => {
            get().updateProject(id, { repoStatus: 'INDEXING' });
          }, 1000);
          
          setTimeout(() => {
            get().updateProject(id, { repoStatus: 'READY' });
          }, 3000);
        }

        return id;
      },

      getProject: (id) => {
        return get().projects.find((p) => p.id === id);
      },

      updateProject: (id, updates) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
          ),
        }));
      },

      deleteProject: (id) => {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          runs: state.runs.filter((r) => r.projectId !== id),
        }));
      },

      addArtifact: (projectId, artifact) => {
        const id = `artifact-${Date.now()}`;
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  artifacts: [...p.artifacts, { ...artifact, id }],
                  artifactsCount: p.artifactsCount + 1,
                  updatedAt: new Date(),
                }
              : p
          ),
        }));
      },

      removeArtifact: (projectId, artifactId) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  artifacts: p.artifacts.filter((a) => a.id !== artifactId),
                  artifactsCount: Math.max(0, p.artifactsCount - 1),
                  updatedAt: new Date(),
                }
              : p
          ),
        }));
      },

      addRun: (runData) => {
        const id = `run-${Date.now()}`;
        
        const newRun: GenerationRun = {
          ...runData,
          id,
          progress: 0,
          createdAt: new Date(),
        };

        set((state) => ({
          runs: [...state.runs, newRun],
        }));

        // Also increment documents count on the project
        const project = get().getProject(runData.projectId);
        if (project) {
          get().updateProject(runData.projectId, { 
            documentsCount: project.documentsCount + 1 
          });
        }

        return id;
      },

      getRun: (id) => {
        return get().runs.find((r) => r.id === id);
      },

      getProjectRuns: (projectId) => {
        // Return runs sorted by most recent first
        return get().runs
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      },

      updateRun: (id, updates) => {
        set((state) => ({
          runs: state.runs.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        }));
      },

      deleteRun: (id) => {
        const run = get().getRun(id);
        set((state) => ({
          runs: state.runs.filter((r) => r.id !== id),
        }));
        // Decrement documents count on the project
        if (run) {
          const project = get().getProject(run.projectId);
          if (project) {
            get().updateProject(run.projectId, { 
              documentsCount: Math.max(0, project.documentsCount - 1) 
            });
          }
        }
      },

      generateDocumentContent: (projectId, runId, templateId) => {
        const project = get().getProject(projectId);
        if (!project) return;

        const { title, sections } = generateMockContent(project, templateId);
        
        get().updateRun(runId, {
          documentTitle: title,
          sections,
          status: 'COMPLETED',
          progress: 100,
          completedAt: new Date(),
        });
      },
    }),
    {
      name: 'docgen-projects',
      // Exclude heavy data from localStorage to improve performance
      partialize: (state) => ({
        projects: state.projects.map((p) => ({
          ...p,
          cachedKnowledgeBase: undefined, // Stored in IndexedDB
          cachedCodeIntelligence: undefined, // Stored in IndexedDB
        })),
        runs: state.runs.map((r) => ({
          ...r,
          // Exclude heavy content from localStorage - only keep metadata
          sections: undefined,
          gaps: undefined,
          chatMessages: undefined,
        })),
      }),
      // Handle Date serialization - keep original format for backwards compatibility
      storage: {
        getItem: (name) => {
          if (typeof window === 'undefined') return null;
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            const data = JSON.parse(str);
            // Convert date strings back to Date objects
            if (data.state?.projects) {
              data.state.projects = data.state.projects.map((p: Project) => ({
                ...p,
                createdAt: new Date(p.createdAt),
                updatedAt: new Date(p.updatedAt),
                artifacts: p.artifacts || [],
              }));
            }
            if (data.state?.runs) {
              data.state.runs = data.state.runs.map((r: GenerationRun) => ({
                ...r,
                createdAt: new Date(r.createdAt),
                completedAt: r.completedAt ? new Date(r.completedAt) : undefined,
              }));
            }
            return data;
          } catch (error) {
            console.error('[Store] Failed to parse localStorage data:', error);
            return null;
          }
        },
        setItem: (name, value) => {
          if (typeof window === 'undefined') return;
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch (error: any) {
            if (error.name === 'QuotaExceededError' || error.code === 22) {
              console.warn('[Store] localStorage quota exceeded, trimming data');
              try {
                // Trim nodeSummaries and old runs to make space
                const data = typeof value === 'string' ? JSON.parse(value) : value;
                if (data?.state?.projects) {
                  data.state.projects = data.state.projects.map((p: Project) => ({
                    ...p,
                    nodeSummaries: undefined,
                  }));
                }
                if (data?.state?.runs) {
                  data.state.runs = data.state.runs.slice(-5);
                }
                localStorage.setItem(name, JSON.stringify(data));
              } catch {
                // Give up
              }
            }
          }
        },
        removeItem: (name) => {
          if (typeof window === 'undefined') return;
          localStorage.removeItem(name);
        },
      },
      // Skip automatic hydration on initialization - we'll trigger it manually
      // This prevents blocking the main thread during navigation
      skipHydration: true,
    }
  )
);

// Trigger hydration only once on the client side
if (typeof window !== 'undefined') {
  // Use requestIdleCallback to hydrate during idle time, or setTimeout as fallback
  const hydrateStore = () => {
    useProjectsStore.persist.rehydrate();
  };
  
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(hydrateStore, { timeout: 500 });
  } else {
    setTimeout(hydrateStore, 10);
  }
}

// Optimized selectors for better performance
// Use these instead of calling store methods inside selectors

/** Select a specific project by ID - stable reference */
export const selectProject = (id: string) => (state: ProjectsState) => 
  state.projects.find(p => p.id === id);

/** Select runs for a specific project - stable reference */
export const selectProjectRuns = (projectId: string) => (state: ProjectsState) =>
  state.runs
    .filter(r => r.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

/** Select a specific run by ID - stable reference */
export const selectRun = (id: string) => (state: ProjectsState) =>
  state.runs.find(r => r.id === id);

/**
 * Select run sections in stable order
 * Uses sectionOrder array if available, otherwise maintains existing order
 * This prevents section reordering during concurrent generation
 */
export const selectRunSectionsOrdered = (runId: string) => (state: ProjectsState) => {
  const run = state.runs.find(r => r.id === runId);
  if (!run?.sections) return [];

  // If no sectionOrder defined, return sections as-is
  if (!run.sectionOrder || run.sectionOrder.length === 0) {
    return run.sections;
  }

  // Create a map for O(1) lookup
  const sectionMap = new Map(run.sections.map(s => [s.id, s]));

  // Return sections in the defined order, then any new sections not in order
  const ordered: GeneratedSection[] = [];
  for (const id of run.sectionOrder) {
    const section = sectionMap.get(id);
    if (section) {
      ordered.push(section);
      sectionMap.delete(id);
    }
  }

  // Append any sections not in the order list (shouldn't happen normally)
  for (const section of sectionMap.values()) {
    ordered.push(section);
  }

  return ordered;
};

