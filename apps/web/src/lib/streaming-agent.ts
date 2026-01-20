/**
 * Streaming Evidence Agent
 *
 * Streams content generation to the UI in real-time for better perceived performance.
 * Users see progress immediately instead of waiting for the entire block to complete.
 *
 * Expected impact: 60-70% reduction in perceived latency
 */

import OpenAI from 'openai';
import { EvidenceAgentContext, ThinkingStep } from './evidence-agent';
import { EvidenceBundle, retrieveEvidence } from './evidence-first';
import { getAvailableTools, executeTool, formatToolResultForDocument, ToolContext } from './llm-tools';

export interface StreamingChunk {
  type: 'thinking' | 'content' | 'tool' | 'chart' | 'complete';
  data: any;
  timestamp: number;
}

export type StreamCallback = (chunk: StreamingChunk) => void;

export interface StreamingResult {
  content: string;
  citations: string[];
  generatedImages?: Array<{ base64: string; mimeType: string; description?: string }>;
  executedCode?: string;
  confidence: number;
}

/**
 * Generate a section with real-time streaming updates
 */
export async function generateSectionWithStreaming(
  ctx: EvidenceAgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  onStream: StreamCallback
): Promise<StreamingResult> {
  const startTime = Date.now();

  // Step 1: Evidence Collection (non-streaming)
  onStream({
    type: 'thinking',
    data: { message: 'Collecting evidence from codebase...', step: 'evidence' },
    timestamp: Date.now(),
  });

  const evidenceBundle = await retrieveEvidence(
    sectionTitle,
    sectionInstructions,
    ctx.codeIntelligence,
    ctx.allFiles,
    ctx.openai,
    ctx.config,
    ctx.repoUrl,
    ctx.nodeSummaries,
    ctx.schemaAuditCache,
    ctx.globalDataEvidence
  );

  onStream({
    type: 'thinking',
    data: {
      message: `Found ${evidenceBundle.tier1Sources.length} Tier-1 sources`,
      step: 'evidence_complete',
    },
    timestamp: Date.now(),
  });

  // Step 2: Build prompt
  const systemPrompt = buildSystemPrompt(ctx.blockType);
  const userPrompt = buildUserPrompt(sectionTitle, sectionInstructions, evidenceBundle, ctx.blockType);

  // Step 3: Stream content generation
  onStream({
    type: 'thinking',
    data: { message: 'Generating documentation...', step: 'generation' },
    timestamp: Date.now(),
  });

  const tools = await getAvailableTools();
  const hasTools = tools.length > 0;

  // For non-tool blocks, stream the content directly
  if (!hasTools || ctx.blockType === 'LLM_TEXT') {
    return await streamTextGeneration(ctx.openai, systemPrompt, userPrompt, onStream);
  }

  // For chart/table blocks with tools, use tool-based generation (can't stream tools)
  return await generateWithToolsNoStream(ctx, systemPrompt, userPrompt, evidenceBundle, tools, onStream);
}

/**
 * Stream text generation for pure text blocks
 */
async function streamTextGeneration(
  openai: OpenAI,
  systemPrompt: string,
  userPrompt: string,
  onStream: StreamCallback
): Promise<StreamingResult> {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
    stream: true, // Enable streaming!
  });

  let fullContent = '';

  // Stream chunks to UI as they arrive
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;

    if (delta) {
      fullContent += delta;

      onStream({
        type: 'content',
        data: { delta, fullContent },
        timestamp: Date.now(),
      });
    }
  }

  // Extract citations (basic pattern matching)
  const citations = extractCitations(fullContent);

  onStream({
    type: 'complete',
    data: { content: fullContent, citations },
    timestamp: Date.now(),
  });

  return {
    content: fullContent,
    citations,
    confidence: 0.8,
  };
}

/**
 * Generate with tools (charts/tables) - can't stream, but emit progress updates
 */
async function generateWithToolsNoStream(
  ctx: EvidenceAgentContext,
  systemPrompt: string,
  userPrompt: string,
  evidenceBundle: EvidenceBundle,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  onStream: StreamCallback
): Promise<StreamingResult> {
  const toolContext: ToolContext = {
    projectName: ctx.projectName,
    repoUrl: ctx.repoUrl,
    codebaseFiles: ctx.allFiles.map(f => f.path),
    currentSection: '',
  };

  let content = '';
  const generatedImages: Array<{ base64: string; mimeType: string; description?: string }> = [];
  let executedCode: string | undefined;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.3,
    max_tokens: 2000,
    tools,
    tool_choice: ctx.blockType === 'LLM_CHART' ? { type: 'function', function: { name: 'generate_chart' } } : 'auto',
  });

  const maxIterations = 5;
  let iterations = 0;

  while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
    iterations++;
    const toolCalls = response.choices[0].message.tool_calls;

    // Emit progress for each tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;

      onStream({
        type: 'tool',
        data: { toolName, iteration: iterations },
        timestamp: Date.now(),
      });

      const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
      const toolResult = await executeTool(toolName, toolArgs, toolContext);
      const formatted = formatToolResultForDocument(toolName, toolResult);

      if (toolName === 'generate_chart' && formatted.generatedImage) {
        generatedImages.push({
          base64: formatted.generatedImage.base64,
          mimeType: formatted.generatedImage.mimeType,
          description: toolArgs.description || 'Chart',
        });

        executedCode = formatted.executedCode;

        // Emit chart immediately
        onStream({
          type: 'chart',
          data: {
            image: formatted.generatedImage,
            description: toolArgs.description,
          },
          timestamp: Date.now(),
        });
      }

      messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }

    // Continue conversation
    response = await ctx.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      max_tokens: 2000,
      tools,
      tool_choice: 'auto',
    });
  }

  content = response.choices[0]?.message?.content || '';

  const citations = extractCitations(content);

  onStream({
    type: 'complete',
    data: { content, citations, generatedImages },
    timestamp: Date.now(),
  });

  return {
    content,
    citations,
    generatedImages,
    executedCode,
    confidence: 0.8,
  };
}

/**
 * Build system prompt (simplified)
 */
function buildSystemPrompt(blockType?: string): string {
  let basePrompt = `You are an EVIDENCE-FIRST documentation agent generating audit-grade banking documentation.

## CRITICAL RULES

1. **EVIDENCE HIERARCHY**
   - TIER-1 (MUST USE): Core code, configs, SQL, tests, notebooks, dataset schemas
   - TIER-2 (LOW TRUST): README, docs - use ONLY if corroborated by Tier-1

2. **CITATION REQUIREMENTS**
   - Every claim MUST cite a specific file: [filename.ext]
   - If no Tier-1 evidence exists, mark: [EVIDENCE GAP: description]

3. **NO SPECULATION**
   - Do NOT invent file paths, code examples, or technical details
   - Do NOT invent names, dates, versions, or approval information
   - If information is missing, say so explicitly with [EVIDENCE GAP: ...]`;

  if (blockType === 'LLM_CHART') {
    basePrompt += `

## CHART GENERATION REQUIREMENTS

- You MUST use the generate_chart tool to create visualizations
- Generate 2-3 charts showing different aspects of the data
- Use load_data('filename') to access data files
- DO NOT include plt.savefig() or plt.show() in your code
- DO NOT include markdown code fences (\`\`\`python) - return clean Python code only`;
  }

  return basePrompt;
}

/**
 * Build user prompt (simplified)
 */
function buildUserPrompt(
  sectionTitle: string,
  sectionInstructions: string,
  evidenceBundle: EvidenceBundle,
  blockType?: string
): string {
  let prompt = `Write the "${sectionTitle}" section using ONLY the evidence provided below.

**Requirements:** ${sectionInstructions}

## TIER-1 EVIDENCE (Code, Config, SQL, Tests)

`;

  // Add Tier-1 sources
  for (const source of evidenceBundle.tier1Sources.slice(0, 10)) {
    prompt += `### ${source.filePath}\n`;
    prompt += `\`\`\`\n${source.content.slice(0, 1000)}\n\`\`\`\n\n`;
  }

  // Add data evidence if present
  if (evidenceBundle.dataEvidence.length > 0) {
    prompt += `## DATA EVIDENCE (Computed Schema)\n\n`;
    for (const data of evidenceBundle.dataEvidence.slice(0, 3)) {
      prompt += `**${data.filePath}**: ${data.rowCount} rows, ${data.columns.length} columns\n`;
      prompt += `Columns: ${data.columns.slice(0, 10).map(c => c.name).join(', ')}\n\n`;
    }
  }

  prompt += `\n**Generate the section content now.**`;

  return prompt;
}

/**
 * Extract citations from content
 */
function extractCitations(content: string): string[] {
  const citations: string[] = [];
  const citationRegex = /\[([^\]]+\.[a-zA-Z]+(?::\d+(?:-\d+)?)?)\]/g;
  let match;

  while ((match = citationRegex.exec(content)) !== null) {
    const filePath = match[1].split(':')[0];
    if (!citations.includes(filePath)) {
      citations.push(filePath);
    }
  }

  return citations;
}
