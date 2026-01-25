import OpenAI from 'openai';
import { z, ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ===========================================
// Configuration
// Supports Azure OpenAI via OPENAI_BASE_URL and MODEL_DEFAULT env vars
// Set MODEL_DEFAULT to "azure.gpt-4o" or your deployment name for Azure
// ===========================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const MODEL_DEFAULT = process.env.MODEL_DEFAULT || 'gpt-4o';
const MODEL_FAST = process.env.MODEL_FAST || 'gpt-4o-mini';

// ===========================================
// Types
// ===========================================

export interface ModelGatewayConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface ModelResponse<T> {
  content: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
  latencyMs: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodSchema;
}

// ===========================================
// Model Gateway
// ===========================================

export class ModelGateway {
  private client: OpenAI;
  private defaultConfig: ModelGatewayConfig;

  constructor(config?: ModelGatewayConfig) {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.client = new OpenAI({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL && { baseURL: OPENAI_BASE_URL }),
    });

    this.defaultConfig = {
      model: MODEL_DEFAULT,
      temperature: 0.3,
      maxTokens: 4096,
      timeout: 60000,
      ...config,
    };
  }

  /**
   * Generate a completion with structured JSON output
   */
  async generateStructured<T>(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    outputSchema: ZodSchema<T>,
    config?: ModelGatewayConfig
  ): Promise<ModelResponse<T>> {
    const startTime = Date.now();
    const mergedConfig = { ...this.defaultConfig, ...config };

    const response = await this.client.chat.completions.create({
      model: mergedConfig.model!,
      messages,
      temperature: mergedConfig.temperature,
      max_tokens: mergedConfig.maxTokens,
      response_format: { type: 'json_object' },
    });

    const latencyMs = Date.now() - startTime;
    const rawContent = response.choices[0]?.message?.content || '{}';
    
    let parsed: T;
    try {
      const jsonContent = JSON.parse(rawContent);
      parsed = outputSchema.parse(jsonContent);
    } catch (error) {
      throw new Error(`Failed to parse response: ${error}`);
    }

    return {
      content: parsed,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
      finishReason: response.choices[0]?.finish_reason || 'unknown',
      latencyMs,
    };
  }

  /**
   * Generate a completion with tool calling support
   */
  async generateWithTools(
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }>,
    tools: ToolDefinition[],
    config?: ModelGatewayConfig
  ): Promise<{
    content: string | null;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    const mergedConfig = { ...this.defaultConfig, ...config };

    const openaiTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));

    const response = await this.client.chat.completions.create({
      model: mergedConfig.model!,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: mergedConfig.temperature,
      max_tokens: mergedConfig.maxTokens,
      tools: openaiTools,
    });

    const message = response.choices[0]?.message;
    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    })) || [];

    return {
      content: message?.content || null,
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
    };
  }

  /**
   * Generate a streaming completion
   */
  async *generateStream(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    config?: ModelGatewayConfig
  ): AsyncGenerator<StreamChunk> {
    const mergedConfig = { ...this.defaultConfig, ...config };

    const stream = await this.client.chat.completions.create({
      model: mergedConfig.model!,
      messages,
      temperature: mergedConfig.temperature,
      max_tokens: mergedConfig.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      const done = chunk.choices[0]?.finish_reason !== null;
      yield { content, done };
    }
  }

  /**
   * Generate embeddings for text
   */
  async embed(
    texts: string[],
    model: string = 'text-embedding-3-small'
  ): Promise<{ embeddings: number[][]; usage: { totalTokens: number } }> {
    const response = await this.client.embeddings.create({
      model,
      input: texts,
    });

    return {
      embeddings: response.data.map((d) => d.embedding),
      usage: {
        totalTokens: response.usage.total_tokens,
      },
    };
  }

  /**
   * Get the fast model name
   */
  get fastModel(): string {
    return MODEL_FAST;
  }

  /**
   * Get the default model name
   */
  get defaultModel(): string {
    return this.defaultConfig.model!;
  }
}

// ===========================================
// Singleton Instance
// ===========================================

let gatewayInstance: ModelGateway | null = null;

export function getModelGateway(): ModelGateway {
  if (!gatewayInstance) {
    gatewayInstance = new ModelGateway();
  }
  return gatewayInstance;
}

