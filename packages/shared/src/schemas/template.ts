import { z } from 'zod';

// ===========================================
// Block Types
// ===========================================

export const BlockTypeEnum = z.enum([
  'STATIC_TEXT',
  'LLM_TEXT',
  'LLM_TABLE',
  'LLM_CHART',
  'LLM_FIGURE',
  'USER_INPUT',
]);

export type BlockType = z.infer<typeof BlockTypeEnum>;

// ===========================================
// Input References
// ===========================================

export const InputRefTypeEnum = z.enum(['REPO', 'ARTIFACT', 'COMPUTED', 'USER_PROVIDED']);

export const InputRefSchema = z.object({
  id: z.string().uuid(),
  type: InputRefTypeEnum,
  sourceId: z.string().optional(), // artifactId, computed output id, etc.
  query: z.string().optional(), // For repo: semantic search query
  filters: z
    .object({
      filePatterns: z.array(z.string()).optional(),
      symbolTypes: z.array(z.string()).optional(),
      maxChunks: z.number().int().positive().optional(),
    })
    .optional(),
  description: z.string().optional(),
});

export type InputRef = z.infer<typeof InputRefSchema>;

// ===========================================
// User Input Fields (for USER_INPUT blocks)
// ===========================================

export const UserFieldTypeEnum = z.enum([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'SELECT',
  'MULTISELECT',
  'FILE_UPLOAD',
  'CHECKBOX',
]);

export const UserFieldSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  label: z.string().min(1),
  type: UserFieldTypeEnum,
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
      })
    )
    .optional(), // For SELECT/MULTISELECT
  validation: z
    .object({
      minLength: z.number().int().optional(),
      maxLength: z.number().int().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      allowedFileTypes: z.array(z.string()).optional(),
      maxFileSizeMB: z.number().positive().optional(),
    })
    .optional(),
});

export type UserField = z.infer<typeof UserFieldSchema>;

// ===========================================
// Output Contracts (per block type)
// ===========================================

export const LLMTextOutputSchema = z.object({
  markdown: z.string(),
});

export const TableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  dataType: z.enum(['string', 'number', 'date', 'boolean', 'currency', 'percentage']),
});

export const LLMTableOutputSchema = z.object({
  columns: z.array(TableColumnSchema).min(1),
  rows: z.array(z.record(z.unknown())),
  notes: z.string().optional(),
});

export const ChartTypeEnum = z.enum([
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'heatmap',
  'treemap',
]);

export const LLMChartOutputSchema = z.object({
  chartType: ChartTypeEnum,
  title: z.string().optional(),
  xKey: z.string(),
  yKeys: z.array(z.string()).min(1),
  series: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        color: z.string().optional(),
      })
    )
    .optional(),
  data: z.array(z.record(z.unknown())),
  caption: z.string().optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
});

export const LLMFigureOutputSchema = z.object({
  imageUrl: z.string().url().optional(),
  altText: z.string(),
  caption: z.string().optional(),
  sourceRef: z.string().optional(),
});

// ===========================================
// Block Output Wrapper (includes confidence/gaps)
// ===========================================

export const GapSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  suggestedAction: z.string().optional(),
});

export const BlockOutputWrapperSchema = z.object({
  confidence: z.number().min(0).max(1),
  gaps: z.array(GapSchema).default([]),
  output: z.union([
    LLMTextOutputSchema,
    LLMTableOutputSchema,
    LLMChartOutputSchema,
    LLMFigureOutputSchema,
    z.record(z.unknown()), // For USER_INPUT and STATIC_TEXT
  ]),
});

export type BlockOutputWrapper = z.infer<typeof BlockOutputWrapperSchema>;

// ===========================================
// Regeneration & Citation Policies
// ===========================================

export const RegenerationPolicySchema = z.object({
  allowed: z.boolean().default(true),
  maxAttempts: z.number().int().positive().default(3),
  cacheKeyStrategy: z.enum(['none', 'inputs_hash', 'full_context']).default('inputs_hash'),
});

export const CitationPolicySchema = z.object({
  requireCitations: z.boolean().default(true),
  minCitations: z.number().int().nonnegative().optional(),
  allowedSources: z
    .array(z.enum(['repo', 'artifact', 'web', 'user_provided']))
    .default(['repo', 'artifact']),
});

// ===========================================
// Block Schema
// ===========================================

export const BlockSchema = z.object({
  id: z.string().uuid(),
  type: BlockTypeEnum,
  title: z.string().min(1),
  instructions: z.string().optional(), // For LLM blocks: what to generate
  inputs: z.array(InputRefSchema).default([]),
  outputContract: z
    .object({
      schema: z.enum(['LLM_TEXT', 'LLM_TABLE', 'LLM_CHART', 'LLM_FIGURE', 'USER_INPUT', 'STATIC']),
      tableColumns: z.array(TableColumnSchema).optional(), // Pre-defined columns for LLM_TABLE
      chartConfig: z
        .object({
          preferredType: ChartTypeEnum.optional(),
          xKey: z.string().optional(),
          yKeys: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  staticText: z.string().optional(), // Only for STATIC_TEXT
  userFields: z.array(UserFieldSchema).optional(), // Only for USER_INPUT
  regenerationPolicy: RegenerationPolicySchema.default({
    allowed: true,
    maxAttempts: 3,
    cacheKeyStrategy: 'inputs_hash',
  }),
  citationPolicy: CitationPolicySchema.default({
    requireCitations: true,
    allowedSources: ['repo', 'artifact'],
  }),
});

export type Block = z.infer<typeof BlockSchema>;

// ===========================================
// Section Schema (recursive)
// ===========================================

// Base Section Schema (without recursion)
const BaseSectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  level: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  description: z.string().optional(),
  blocks: z.array(BlockSchema).default([]),
});

// Recursive Section type
export type Section = z.infer<typeof BaseSectionSchema> & {
  childrenSections: Section[];
};

// Recursive Section schema using z.lazy
export const SectionSchema: z.ZodType<Section> = BaseSectionSchema.extend({
  childrenSections: z.lazy(() => z.array(SectionSchema).default([])),
}) as z.ZodType<Section>;

// ===========================================
// Template Schema (Main)
// ===========================================

export const TemplateSchemaVersion = '1.0.0';

export const TemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z.string().default(TemplateSchemaVersion),
  schemaVersion: z.literal(TemplateSchemaVersion).default(TemplateSchemaVersion),
  category: z.enum(['model_documentation', 'validation_report', 'custom', 'technical_spec']).optional(),
  tags: z.array(z.string()).default([]),
  sections: z.array(SectionSchema).min(1),
  metadata: z
    .object({
      author: z.string().optional(),
      createdAt: z.string().datetime().optional(),
      updatedAt: z.string().datetime().optional(),
      estimatedGenerationTime: z.number().positive().optional(), // minutes
    })
    .optional(),
});

export type Template = z.infer<typeof TemplateSchema>;

// ===========================================
// Template Validation Helpers
// ===========================================

export function validateTemplate(data: unknown): { success: true; data: Template } | { success: false; errors: z.ZodError } {
  const result = TemplateSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

export function getAllBlocks(template: Template): Block[] {
  const blocks: Block[] = [];
  
  function collectBlocks(sections: Section[]) {
    for (const section of sections) {
      blocks.push(...section.blocks);
      collectBlocks(section.childrenSections);
    }
  }
  
  collectBlocks(template.sections);
  return blocks;
}

export function getBlockById(template: Template, blockId: string): Block | undefined {
  return getAllBlocks(template).find((b) => b.id === blockId);
}

