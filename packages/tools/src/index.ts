// ===========================================
// DocGen.AI Tools Package
// ===========================================

export * from './model-gateway';

// ===========================================
// Tool Registry Types
// ===========================================

export interface ToolContext {
  prisma: unknown;
  logger: unknown;
  modelGateway?: unknown;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  executionTimeMs: number;
}

// ===========================================
// Tool Executor
// ===========================================

export async function executeTool<TInput, TOutput>(
  _toolName: string,
  input: TInput,
  executor: (input: TInput, ctx: ToolContext) => Promise<TOutput>,
  ctx: ToolContext
): Promise<ToolResult<TOutput>> {
  const startTime = Date.now();
  
  try {
    const data = await executor(input, ctx);
    return {
      success: true,
      data,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

