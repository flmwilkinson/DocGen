// ===========================================
// DocGen.AI Shared Schemas
// ===========================================

// Template schemas
export * from './template';

// Entity schemas
export * from './entities';

// Knowledge graph schemas
export * from './knowledge-graph';

// Tool schemas
export * from './tools';

// Generation schemas
export * from './generation';

// ===========================================
// JSON Schema Exports (for OpenAI)
// ===========================================

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  TemplateSchema,
  BlockSchema,
  SectionSchema,
} from './template';
import {
  LLMTextBlockOutputSchema,
  LLMTableBlockOutputSchema,
  LLMChartBlockOutputSchema,
  BlockPlanSchema,
} from './generation';

export const JsonSchemas = {
  Template: zodToJsonSchema(TemplateSchema, 'Template'),
  Block: zodToJsonSchema(BlockSchema, 'Block'),
  Section: zodToJsonSchema(SectionSchema, 'Section'),
  LLMTextBlockOutput: zodToJsonSchema(LLMTextBlockOutputSchema, 'LLMTextBlockOutput'),
  LLMTableBlockOutput: zodToJsonSchema(LLMTableBlockOutputSchema, 'LLMTableBlockOutput'),
  LLMChartBlockOutput: zodToJsonSchema(LLMChartBlockOutputSchema, 'LLMChartBlockOutput'),
  BlockPlan: zodToJsonSchema(BlockPlanSchema, 'BlockPlan'),
};

