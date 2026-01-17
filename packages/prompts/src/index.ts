import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import Handlebars from 'handlebars';

// ===========================================
// Prompt Loader
// ===========================================

export interface PromptMetadata {
  name: string;
  version: string;
  description?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface LoadedPrompt {
  metadata: PromptMetadata;
  content: string;
  compiled: HandlebarsTemplateDelegate;
}

export interface AgentPrompts {
  system: LoadedPrompt;
  task: LoadedPrompt;
  examples?: LoadedPrompt;
}

const promptCache = new Map<string, LoadedPrompt>();

/**
 * Load a single prompt file
 */
export function loadPrompt(promptPath: string): LoadedPrompt {
  const cached = promptCache.get(promptPath);
  if (cached) return cached;

  const fullPath = path.resolve(__dirname, '..', 'agents', promptPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const { data, content: body } = matter(content);

  const prompt: LoadedPrompt = {
    metadata: {
      name: data.name || path.basename(promptPath, '.md'),
      version: data.version || '1.0.0',
      description: data.description,
      model: data.model,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      responseFormat: data.responseFormat,
    },
    content: body.trim(),
    compiled: Handlebars.compile(body.trim()),
  };

  promptCache.set(promptPath, prompt);
  return prompt;
}

/**
 * Load all prompts for an agent
 */
export function loadAgentPrompts(agentName: string): AgentPrompts {
  const basePath = agentName;
  
  return {
    system: loadPrompt(`${basePath}/system.md`),
    task: loadPrompt(`${basePath}/task.md`),
    examples: fs.existsSync(path.resolve(__dirname, '..', 'agents', `${basePath}/examples.md`))
      ? loadPrompt(`${basePath}/examples.md`)
      : undefined,
  };
}

/**
 * Render a prompt with variables
 */
export function renderPrompt(
  prompt: LoadedPrompt,
  variables: Record<string, unknown>
): string {
  return prompt.compiled(variables);
}

/**
 * Build messages array for OpenAI API
 */
export function buildMessages(
  prompts: AgentPrompts,
  taskVariables: Record<string, unknown>,
  systemVariables?: Record<string, unknown>
): Array<{ role: 'system' | 'user'; content: string }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

  // System message
  let systemContent = renderPrompt(prompts.system, systemVariables || {});
  
  // Add examples to system if available
  if (prompts.examples) {
    systemContent += '\n\n## Examples\n\n' + renderPrompt(prompts.examples, {});
  }

  messages.push({ role: 'system', content: systemContent });

  // Task message
  messages.push({
    role: 'user',
    content: renderPrompt(prompts.task, taskVariables),
  });

  return messages;
}

/**
 * Clear prompt cache (for hot reloading in dev)
 */
export function clearPromptCache(): void {
  promptCache.clear();
}

// ===========================================
// Agent Names
// ===========================================

export const AgentNames = {
  TEMPLATE_BUILDER: 'template-builder',
  REPO_INGEST: 'repo-ingest',
  KNOWLEDGE_GRAPH: 'knowledge-graph',
  RETRIEVAL: 'retrieval',
  BLOCK_PLANNER: 'block-planner',
  BLOCK_WRITER: 'block-writer',
  TABLE_BUILDER: 'table-builder',
  CHART_BUILDER: 'chart-builder',
  GAP_DETECTOR: 'gap-detector',
  EXPORT: 'export',
} as const;

export type AgentName = (typeof AgentNames)[keyof typeof AgentNames];

