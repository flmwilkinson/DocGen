import { z } from 'zod';

// ===========================================
// Block Execution Plan
// ===========================================

export const BlockStrategyEnum = z.enum([
  'RETRIEVE', // Pure retrieval + synthesis
  'PYTHON', // Requires Python sandbox execution
  'REPO_RUN', // Requires running repo commands
  'ASK_USER', // Requires user input
  'STATIC', // Static content (no generation needed)
  'COMPUTED', // Depends on other block outputs
]);

export type BlockStrategy = z.infer<typeof BlockStrategyEnum>;

export const BlockPlanSchema = z.object({
  blockId: z.string().uuid(),
  strategy: BlockStrategyEnum,
  dependencies: z.array(z.string().uuid()).default([]), // Block IDs this depends on
  retrievalQueries: z.array(z.object({
    query: z.string(),
    filters: z.object({
      filePatterns: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
    }).optional(),
    topK: z.number().int().positive().default(5),
  })).optional(),
  pythonCode: z.string().optional(),
  repoCommand: z.object({
    cmd: z.string(),
    args: z.array(z.string()).optional(),
    workingDir: z.string().optional(),
  }).optional(),
  userQuestions: z.array(z.object({
    question: z.string(),
    inputType: z.enum(['text', 'file', 'choice']),
    required: z.boolean().default(true),
  })).optional(),
  expectedArtifacts: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
  })).optional(),
  acceptanceChecks: z.array(z.object({
    description: z.string(),
    condition: z.string(), // Human-readable condition
    severity: z.enum(['warning', 'error']),
  })).optional(),
  estimatedTokens: z.number().int().positive().optional(),
  priority: z.number().int().default(0), // Higher = process first
});

export type BlockPlan = z.infer<typeof BlockPlanSchema>;

// ===========================================
// Generation Plan (Full Document)
// ===========================================

export const GenerationPlanSchema = z.object({
  id: z.string().uuid(),
  generationRunId: z.string().uuid(),
  templateId: z.string().uuid(),
  blockPlans: z.array(BlockPlanSchema),
  executionOrder: z.array(z.string().uuid()), // Topologically sorted block IDs
  estimatedTotalTokens: z.number().int().positive().optional(),
  estimatedDurationMs: z.number().int().positive().optional(),
  createdAt: z.date(),
});

export type GenerationPlan = z.infer<typeof GenerationPlanSchema>;

// ===========================================
// Block Execution Context
// ===========================================

export const BlockExecutionContextSchema = z.object({
  blockId: z.string().uuid(),
  plan: BlockPlanSchema,
  retrievedChunks: z.array(z.object({
    id: z.string(),
    text: z.string(),
    sourceRef: z.string(),
    score: z.number(),
  })).optional(),
  pythonResult: z.object({
    stdout: z.string(),
    generatedFiles: z.array(z.object({
      filename: z.string(),
      artifactId: z.string().uuid(),
    })),
    structuredResult: z.record(z.unknown()).optional(),
  }).optional(),
  repoRunResult: z.object({
    stdout: z.string(),
    exitCode: z.number().int(),
    producedArtifacts: z.array(z.string().uuid()),
  }).optional(),
  userAnswers: z.record(z.string()).optional(),
  dependencyOutputs: z.record(z.record(z.unknown())).optional(), // blockId -> output
  templateContext: z.object({
    templateName: z.string(),
    sectionTitle: z.string(),
    blockTitle: z.string(),
    instructions: z.string().optional(),
  }),
  repoContext: z.object({
    repoOverview: z.string(),
    relevantFiles: z.array(z.string()),
  }).optional(),
});

export type BlockExecutionContext = z.infer<typeof BlockExecutionContextSchema>;

// ===========================================
// Agent Messages
// ===========================================

export const AgentMessageRoleEnum = z.enum(['system', 'user', 'assistant', 'tool']);

export const AgentMessageSchema = z.object({
  role: AgentMessageRoleEnum,
  content: z.string(),
  name: z.string().optional(), // For tool messages
  toolCallId: z.string().optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// ===========================================
// Agent Trace (for debugging)
// ===========================================

export const AgentTraceEventSchema = z.object({
  timestamp: z.date(),
  eventType: z.enum([
    'prompt_sent',
    'response_received',
    'tool_call',
    'tool_result',
    'error',
    'retry',
    'completion',
  ]),
  agentName: z.string(),
  data: z.record(z.unknown()),
  durationMs: z.number().int().optional(),
  tokenUsage: z.object({
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
  }).optional(),
});

export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>;

export const AgentTraceSchema = z.object({
  id: z.string().uuid(),
  generationRunId: z.string().uuid(),
  blockId: z.string().uuid().optional(),
  events: z.array(AgentTraceEventSchema),
  totalTokens: z.number().int().default(0),
  totalDurationMs: z.number().int().default(0),
  status: z.enum(['running', 'completed', 'failed']),
  error: z.string().optional(),
});

export type AgentTrace = z.infer<typeof AgentTraceSchema>;

// ===========================================
// Structured Output Schemas for LLM
// ===========================================

export const LLMTextBlockOutputSchema = z.object({
  markdown: z.string().describe('The generated markdown content'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
  citations: z.array(z.object({
    sourceRef: z.string().describe('Reference to source (file path or artifact ID)'),
    excerpt: z.string().describe('Brief excerpt from the source'),
    relevance: z.string().describe('Why this source is relevant'),
  })).describe('Citations for the generated content'),
  gaps: z.array(z.object({
    description: z.string().describe('What information is missing'),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    suggestedQuestion: z.string().describe('Question to ask the user'),
  })).describe('Identified gaps or missing information'),
});

export const LLMTableBlockOutputSchema = z.object({
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    dataType: z.enum(['string', 'number', 'date', 'boolean', 'currency', 'percentage']),
  })),
  rows: z.array(z.record(z.unknown())),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(1),
  citations: z.array(z.object({
    sourceRef: z.string(),
    excerpt: z.string(),
    relevance: z.string(),
  })),
  gaps: z.array(z.object({
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    suggestedQuestion: z.string(),
  })),
});

export const LLMChartBlockOutputSchema = z.object({
  chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'treemap']),
  title: z.string().optional(),
  xKey: z.string(),
  yKeys: z.array(z.string()),
  data: z.array(z.record(z.unknown())),
  caption: z.string().optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
  confidence: z.number().min(0).max(1),
  citations: z.array(z.object({
    sourceRef: z.string(),
    excerpt: z.string(),
    relevance: z.string(),
  })),
  gaps: z.array(z.object({
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    suggestedQuestion: z.string(),
  })),
});

// ===========================================
// Re-run Context
// ===========================================

export const RerunContextSchema = z.object({
  triggeredBy: z.enum(['user_edit', 'gap_answered', 'manual_regenerate', 'dependency_changed']),
  changedBlockIds: z.array(z.string().uuid()),
  newUserAnswers: z.record(z.string()).optional(),
  preserveOutputs: z.array(z.string().uuid()).default([]), // Block IDs to keep
});

export type RerunContext = z.infer<typeof RerunContextSchema>;

