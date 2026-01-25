import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { Logger } from 'pino';
import Redis from 'ioredis';
import { Template, Block, getAllBlocks, generateId } from '@docgen/shared';

// Parallel processing configuration
const SECTION_BATCH_SIZE = parseInt(process.env.SECTION_BATCH_SIZE || '3', 10);

interface GenerationJobData {
  runId: string;
  templateId: string;
  repoSnapshotId?: string;
  artifactIds: string[];
  userContext: Record<string, unknown>;
}

interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
  redis: Redis;
}

// Model configuration - supports Azure OpenAI via MODEL_DEFAULT env var
// Set MODEL_DEFAULT to "azure.gpt-4o" or similar for Azure deployments
const MODEL_DEFAULT = process.env.MODEL_DEFAULT || 'gpt-4o';

// OpenAI client configuration - supports custom base URL for Azure or proxies
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
});

export async function processDocumentGeneration(
  data: GenerationJobData,
  ctx: JobContext
): Promise<{ documentId: string }> {
  const { runId, templateId, repoSnapshotId, artifactIds, userContext } = data;
  const { prisma, logger, redis } = ctx;

  try {
    // Update run status
    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // Get template
    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    const templateJson = template.templateJson as unknown as Template;
    const blocks = getAllBlocks(templateJson);

    logger.info({ runId, blocksCount: blocks.length }, 'Starting document generation');

    // Get repo overview if available
    let repoOverview = '';
    if (repoSnapshotId) {
      const kg = await prisma.knowledgeGraph.findUnique({
        where: { repoSnapshotId },
      });
      if (kg) {
        repoOverview = generateRepoOverview(kg.nodes as unknown[], kg.stats as Record<string, unknown>);
      }
    }

    // Create initial document version
    const docVersion = await prisma.documentVersion.create({
      data: {
        generationRunId: runId,
        title: templateJson.name,
        contentJson: { type: 'doc', content: [] },
      },
    });

    // Process blocks in parallel batches for better performance
    // Blocks are processed in batches of SECTION_BATCH_SIZE for faster completion
    const blockOutputs: Record<string, unknown> = {};
    let processedBlocks = 0;

    // Process a single block and return the result
    const processBlock = async (block: Block): Promise<void> => {
      try {
        // Publish progress via Redis
        await redis.publish(`generation:${runId}`, JSON.stringify({
          type: 'block_started',
          blockId: block.id,
          progress: (processedBlocks / blocks.length) * 100,
        }));

        const output = await generateBlockContent(
          block,
          {
            repoSnapshotId,
            repoOverview,
            previousOutputs: blockOutputs,
            userContext,
          },
          { prisma, logger }
        );

        blockOutputs[block.id] = output;

        // Store block output
        await prisma.blockOutput.create({
          data: {
            documentVersionId: docVersion.id,
            blockId: block.id,
            outputType: block.type,
            content: output.content,
            confidence: output.confidence,
            citations: output.citations,
            rawResponse: output.rawResponse,
          },
        });

        // Create gaps if confidence is low
        if (output.gaps && output.gaps.length > 0) {
          for (const gap of output.gaps) {
            await prisma.gapQuestion.create({
              data: {
                generationRunId: runId,
                blockId: block.id,
                question: gap.suggestedQuestion || gap.description,
                context: gap.description,
                severity: gap.severity as 'low' | 'medium' | 'high' | 'critical',
                status: 'OPEN',
              },
            });
          }
        }

        processedBlocks++;

        await redis.publish(`generation:${runId}`, JSON.stringify({
          type: 'block_completed',
          blockId: block.id,
          progress: (processedBlocks / blocks.length) * 100,
        }));

      } catch (error) {
        logger.error({ error, blockId: block.id }, 'Failed to generate block');

        // Create error gap
        await prisma.gapQuestion.create({
          data: {
            generationRunId: runId,
            blockId: block.id,
            question: `Block generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            severity: 'high',
            status: 'OPEN',
          },
        });
        processedBlocks++;
      }
    };

    // Process blocks in batches for parallelization
    // Static/user blocks are fast, LLM blocks benefit from parallel API calls
    logger.info({ runId, batchSize: SECTION_BATCH_SIZE }, 'Processing blocks in parallel batches');

    for (let i = 0; i < blocks.length; i += SECTION_BATCH_SIZE) {
      const batch = blocks.slice(i, i + SECTION_BATCH_SIZE);

      // Update run progress at batch start
      await prisma.generationRun.update({
        where: { id: runId },
        data: {
          currentBlockId: batch[0].id,
          progress: (processedBlocks / blocks.length) * 100,
        },
      });

      // Process batch in parallel
      await Promise.allSettled(batch.map(processBlock));

      logger.info(
        { runId, batchIndex: Math.floor(i / SECTION_BATCH_SIZE) + 1, processedBlocks, totalBlocks: blocks.length },
        'Batch completed'
      );
    }

    // Build TipTap document
    const tiptapContent = buildTipTapDocument(templateJson, blockOutputs);
    
    await prisma.documentVersion.update({
      where: { id: docVersion.id },
      data: { contentJson: tiptapContent },
    });

    // Update run status
    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        finishedAt: new Date(),
      },
    });

    await redis.publish(`generation:${runId}`, JSON.stringify({
      type: 'generation_completed',
      documentId: docVersion.id,
    }));

    logger.info({ runId, documentId: docVersion.id }, 'Document generation completed');

    return { documentId: docVersion.id };
  } catch (error) {
    logger.error({ error, runId }, 'Document generation failed');

    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        finishedAt: new Date(),
      },
    });

    throw error;
  }
}

interface BlockGenerationContext {
  repoSnapshotId?: string;
  repoOverview: string;
  previousOutputs: Record<string, unknown>;
  userContext: Record<string, unknown>;
}

async function generateBlockContent(
  block: Block,
  context: BlockGenerationContext,
  { prisma, logger }: { prisma: PrismaClient; logger: Logger }
): Promise<{
  content: Record<string, unknown>;
  confidence: number;
  citations: Array<{ sourceRef: string; excerpt: string }>;
  gaps: Array<{ description: string; severity: string; suggestedQuestion: string }>;
  rawResponse?: Record<string, unknown>;
}> {
  // Handle static text blocks
  if (block.type === 'STATIC_TEXT') {
    return {
      content: { markdown: block.staticText || '' },
      confidence: 1,
      citations: [],
      gaps: [],
    };
  }

  // Handle user input blocks
  if (block.type === 'USER_INPUT') {
    const userValue = context.userContext[block.id];
    return {
      content: { value: userValue || null },
      confidence: userValue ? 1 : 0,
      citations: [],
      gaps: userValue ? [] : [{
        description: `User input required for: ${block.title}`,
        severity: 'high',
        suggestedQuestion: `Please provide: ${block.title}`,
      }],
    };
  }

  // Retrieve relevant chunks if repo is available
  let retrievedChunks: Array<{ text: string; sourceRef: string; score: number }> = [];
  if (context.repoSnapshotId && block.inputs?.length) {
    for (const input of block.inputs) {
      if (input.type === 'REPO' && input.query) {
        // TODO: Implement actual vector search
        const chunks = await prisma.vectorChunk.findMany({
          where: { repoSnapshotId: context.repoSnapshotId },
          take: 5,
        });
        
        retrievedChunks.push(...chunks.map((c) => ({
          text: c.content,
          sourceRef: c.sourcePath,
          score: 0.8,
        })));
      }
    }
  }

  // Build prompt
  const systemPrompt = buildSystemPrompt(block.type);
  const userPrompt = buildUserPrompt(block, context, retrievedChunks);

  // Call LLM
  const response = await openai.chat.completions.create({
    model: MODEL_DEFAULT,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 4096,
  });

  const responseText = response.choices[0]?.message?.content || '{}';
  let parsed: Record<string, unknown>;
  
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = { markdown: responseText };
  }

  return {
    content: parsed.output as Record<string, unknown> || parsed,
    confidence: (parsed.confidence as number) || 0.8,
    citations: (parsed.citations as Array<{ sourceRef: string; excerpt: string }>) || [],
    gaps: (parsed.gaps as Array<{ description: string; severity: string; suggestedQuestion: string }>) || [],
    rawResponse: parsed,
  };
}

function buildSystemPrompt(blockType: string): string {
  const basePrompt = `You are a technical documentation writer. Generate accurate, well-structured content based on the provided context. 

Always respond with valid JSON containing:
- "output": The generated content (format depends on block type)
- "confidence": A score from 0 to 1 indicating how well-supported the content is
- "citations": Array of {sourceRef, excerpt} for sources used
- "gaps": Array of {description, severity, suggestedQuestion} for missing information`;

  if (blockType === 'LLM_TABLE') {
    return `${basePrompt}

For table output, format as:
{
  "output": {
    "columns": [{"key": "...", "label": "...", "dataType": "string|number|date"}],
    "rows": [{...}, {...}],
    "notes": "optional notes"
  },
  ...
}`;
  }

  if (blockType === 'LLM_CHART') {
    return `${basePrompt}

For chart output, format as:
{
  "output": {
    "chartType": "bar|line|pie|...",
    "xKey": "...",
    "yKeys": ["..."],
    "data": [{...}],
    "caption": "..."
  },
  ...
}`;
  }

  return `${basePrompt}

For text output, format as:
{
  "output": {
    "markdown": "Your markdown content here..."
  },
  ...
}`;
}

function buildUserPrompt(
  block: Block,
  context: BlockGenerationContext,
  retrievedChunks: Array<{ text: string; sourceRef: string; score: number }>
): string {
  let prompt = `## Block: ${block.title}

**Instructions**: ${block.instructions || 'Generate appropriate content for this section.'}

`;

  if (context.repoOverview) {
    prompt += `## Repository Overview
${context.repoOverview}

`;
  }

  if (retrievedChunks.length > 0) {
    prompt += `## Relevant Code Snippets
`;
    for (const chunk of retrievedChunks) {
      prompt += `### Source: ${chunk.sourceRef}
\`\`\`
${chunk.text.slice(0, 500)}
\`\`\`

`;
    }
  }

  prompt += `
Generate the content now. Ensure all claims are grounded in the provided sources.`;

  return prompt;
}

function generateRepoOverview(nodes: unknown[], stats: Record<string, unknown>): string {
  const nodesByType = stats.nodesByType as Record<string, number> || {};
  
  return `Repository contains ${nodesByType.FILE || 0} files, ${nodesByType.CLASS || 0} classes, and ${nodesByType.FUNCTION || 0} functions.`;
}

function buildTipTapDocument(template: Template, blockOutputs: Record<string, unknown>): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];

  function processSections(sections: typeof template.sections, level: number = 1) {
    for (const section of sections) {
      // Add heading
      content.push({
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text: section.title }],
      });

      // Add blocks
      for (const block of section.blocks) {
        const output = blockOutputs[block.id] as { content?: { markdown?: string } } | undefined;
        if (output?.content?.markdown) {
          content.push({
            type: 'paragraph',
            content: [{ type: 'text', text: output.content.markdown }],
          });
        }
      }

      // Process child sections
      if (section.childrenSections?.length) {
        processSections(section.childrenSections, Math.min(level + 1, 6));
      }
    }
  }

  processSections(template.sections);

  return { type: 'doc', content };
}

