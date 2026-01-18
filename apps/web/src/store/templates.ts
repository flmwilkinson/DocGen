import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BlockType = 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART' | 'STATIC_TEXT' | 'USER_INPUT';

export interface TemplateBlock {
  id: string;
  type: BlockType;
  title: string;
  instructions: string; // The LLM prompt for this block
  dataSources?: string[]; // What data is passed to the LLM
}

export interface TemplateSection {
  id: string;
  title: string;
  description?: string;
  blocks: TemplateBlock[];
  subsections?: TemplateSection[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  sections: TemplateSection[];
}

interface TemplatesState {
  templates: Template[];
  getTemplate: (id: string) => Template | undefined;
  addTemplate: (template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTemplate: (id: string, updates: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;
}

// Default templates with rich structure
const defaultTemplates: Template[] = [
  {
    id: 'tpl-1',
    name: 'Model Documentation',
    description: 'Complete ML model documentation with architecture, training, and evaluation sections',
    createdAt: '2024-01-10',
    updatedAt: '2024-01-15',
    sections: [
      {
        id: 's1',
        title: 'Executive Summary',
        description: 'High-level overview of the model and its purpose',
        blocks: [
          {
            id: 'b1',
            type: 'LLM_TEXT',
            title: 'Model Purpose',
            instructions: `Analyze the repository and write a concise executive summary (2-3 paragraphs) explaining:
- What problem does this model solve?
- What is the business value?
- What are the key capabilities?

Use professional language suitable for senior stakeholders.`,
            dataSources: ['Repository code', 'README files'],
          },
          {
            id: 'b2',
            type: 'LLM_TABLE',
            title: 'Key Metrics Summary',
            instructions: `Extract and present the key performance metrics in a table format with columns:
| Metric | Value | Benchmark | Status |

Include accuracy, precision, recall, F1 if available. If metrics are not found, note "Not available from repository".`,
            dataSources: ['Model evaluation results', 'Config files'],
          },
        ],
      },
      {
        id: 's2',
        title: 'Model Overview',
        description: 'Technical overview of the model architecture',
        blocks: [
          {
            id: 'b3',
            type: 'LLM_TEXT',
            title: 'Architecture Description',
            instructions: `Describe the model architecture in detail:
- Model type (neural network, tree-based, etc.)
- Layer structure and dimensions
- Key components and their purposes
- Any novel or custom architectures used

Include technical details but remain accessible.`,
            dataSources: ['Model definition code', 'Architecture configs'],
          },
        ],
        subsections: [
          {
            id: 's2-1',
            title: 'Input Features',
            blocks: [
              {
                id: 'b5',
                type: 'LLM_TABLE',
                title: 'Feature Definitions',
                instructions: `Create a comprehensive table of all input features:
| Feature Name | Data Type | Description | Valid Range | Preprocessing |

Analyze the code to find all input features used by the model.`,
                dataSources: ['Feature engineering code', 'Data schemas'],
              },
            ],
          },
          {
            id: 's2-2',
            title: 'Output Specifications',
            blocks: [
              {
                id: 'b6',
                type: 'LLM_TEXT',
                title: 'Output Format',
                instructions: `Document the model outputs:
- Output variable(s) and their meanings
- Value ranges and interpretations
- Confidence scores if applicable
- How outputs should be consumed`,
                dataSources: ['Prediction code', 'API schemas'],
              },
            ],
          },
        ],
      },
      {
        id: 's3',
        title: 'Data Requirements',
        description: 'Training and inference data specifications',
        blocks: [
          {
            id: 'b7',
            type: 'LLM_TEXT',
            title: 'Data Sources',
            instructions: `Document all data sources used:
- Source systems and databases
- Data extraction methods
- Refresh frequencies
- Data quality requirements
- Access and permissions needed`,
            dataSources: ['Data pipeline code', 'ETL configs'],
          },
          {
            id: 'b8',
            type: 'LLM_TABLE',
            title: 'Data Schema',
            instructions: `Generate a complete data schema table:
| Column/Field | Data Type | Nullable | Description | Example |

Analyze the code to extract schema information.`,
            dataSources: ['Schema definitions', 'Sample data'],
          },
        ],
      },
      {
        id: 's4',
        title: 'Training Process',
        description: 'How the model is trained and validated',
        blocks: [
          {
            id: 'b9',
            type: 'LLM_TEXT',
            title: 'Training Methodology',
            instructions: `Explain the training process:
- Training/validation/test split ratios
- Cross-validation approach
- Hyperparameter tuning method
- Early stopping criteria
- Hardware/compute requirements`,
            dataSources: ['Training scripts', 'Config files'],
          },
        ],
      },
      {
        id: 's5',
        title: 'Evaluation & Performance',
        description: 'Model performance metrics and analysis',
        blocks: [
          {
            id: 'b11',
            type: 'LLM_TABLE',
            title: 'Performance Metrics',
            instructions: `Compile all evaluation metrics in a table:
| Metric | Training | Validation | Test | Production |

Include all metrics found in the repository.`,
            dataSources: ['Evaluation results', 'Monitoring data'],
          },
          {
            id: 'b12',
            type: 'LLM_TEXT',
            title: 'Performance Analysis',
            instructions: `Provide analysis of model performance:
- Strengths and where model excels
- Weaknesses and edge cases
- Comparison to baseline/previous versions
- Recommendations for improvement`,
            dataSources: ['Evaluation code', 'Error analysis'],
          },
        ],
      },
    ],
  },
  {
    id: 'tpl-2',
    name: 'API Technical Spec',
    description: 'REST API documentation with endpoints, schemas, and examples',
    createdAt: '2024-01-08',
    updatedAt: '2024-01-12',
    sections: [
      {
        id: 's1',
        title: 'Overview',
        blocks: [
          {
            id: 'b1',
            type: 'LLM_TEXT',
            title: 'API Introduction',
            instructions: `Write an introduction to the API:
- Purpose and use cases
- Base URL and versioning
- Rate limits and quotas
- Authentication overview`,
            dataSources: ['API source code', 'Config files'],
          },
        ],
      },
      {
        id: 's2',
        title: 'Authentication',
        blocks: [
          {
            id: 'b2',
            type: 'LLM_TEXT',
            title: 'Auth Methods',
            instructions: `Document authentication methods:
- Supported auth types (API key, OAuth, JWT)
- How to obtain credentials
- Token refresh process
- Security best practices`,
            dataSources: ['Auth middleware code'],
          },
        ],
      },
      {
        id: 's3',
        title: 'Endpoints',
        blocks: [
          {
            id: 'b3',
            type: 'LLM_TABLE',
            title: 'Endpoint Reference',
            instructions: `Generate endpoint reference table:
| Method | Path | Description | Auth Required | Rate Limit |

Find all endpoints defined in the code.`,
            dataSources: ['Route definitions'],
          },
        ],
      },
    ],
  },
  {
    id: 'tpl-3',
    name: 'Model Validation Report',
    description: 'Validation and testing report for ML models',
    createdAt: '2024-01-05',
    updatedAt: '2024-01-14',
    sections: [
      {
        id: 's1',
        title: 'Validation Summary',
        blocks: [
          {
            id: 'b1',
            type: 'LLM_TEXT',
            title: 'Executive Summary',
            instructions: `Summarize validation findings:
- Overall pass/fail status
- Key findings and concerns
- Recommended actions
- Sign-off requirements`,
            dataSources: ['Validation results', 'Test reports'],
          },
        ],
      },
      {
        id: 's2',
        title: 'Test Results',
        blocks: [
          {
            id: 'b2',
            type: 'LLM_TABLE',
            title: 'Test Case Results',
            instructions: `Compile test results:
| Test ID | Description | Expected | Actual | Status | Notes |

Find and document all test cases and their outcomes.`,
            dataSources: ['Test execution logs'],
          },
        ],
      },
    ],
  },
];

export const useTemplatesStore = create<TemplatesState>()(
  persist(
    (set, get) => ({
      templates: defaultTemplates,

      getTemplate: (id) => get().templates.find(t => t.id === id),

      addTemplate: (templateData) => {
        const id = `tpl-${Date.now()}`;
        const now = new Date().toISOString().split('T')[0];
        
        const newTemplate: Template = {
          ...templateData,
          id,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          templates: [...state.templates, newTemplate],
        }));

        return id;
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map(t =>
            t.id === id
              ? { ...t, ...updates, updatedAt: new Date().toISOString().split('T')[0] }
              : t
          ),
        }));
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter(t => t.id !== id),
        }));
      },
    }),
    {
      name: 'docgen-templates',
      // Skip automatic hydration to prevent blocking navigation
      skipHydration: true,
    }
  )
);

// Trigger hydration only once on the client side
if (typeof window !== 'undefined') {
  const hydrateStore = () => {
    useTemplatesStore.persist.rehydrate();
  };
  
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(hydrateStore, { timeout: 500 });
  } else {
    setTimeout(hydrateStore, 10);
  }
}

/**
 * Flatten template sections into a list of blocks with their prompts
 * This is used by the generation engine
 */
export function flattenTemplateBlocks(template: Template): Array<{
  sectionId: string;
  sectionTitle: string;
  sectionPath: string[]; // Full path for nested sections
  blockId: string;
  blockTitle: string;
  blockType: BlockType;
  instructions: string;
  dataSources: string[];
}> {
  const result: ReturnType<typeof flattenTemplateBlocks> = [];
  
  function traverse(sections: TemplateSection[], path: string[] = []) {
    for (const section of sections) {
      const currentPath = [...path, section.title];
      
      for (const block of section.blocks) {
        result.push({
          sectionId: section.id,
          sectionTitle: section.title,
          sectionPath: currentPath,
          blockId: block.id,
          blockTitle: block.title,
          blockType: block.type,
          instructions: block.instructions,
          dataSources: block.dataSources || [],
        });
      }
      
      if (section.subsections) {
        traverse(section.subsections, currentPath);
      }
    }
  }
  
  traverse(template.sections);
  return result;
}

