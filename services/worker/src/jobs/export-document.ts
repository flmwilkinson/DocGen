import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateId } from '@docgen/shared';

interface ExportJobData {
  documentVersionId: string;
  format: 'markdown' | 'docx' | 'pdf';
  options?: {
    includeTableOfContents?: boolean;
    includeCitations?: boolean;
    pageSize?: 'letter' | 'a4';
  };
}

interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
}

const EXPORTS_DIR = process.env.EXPORTS_DIR || '/tmp/docgen-exports';

export async function processExportDocument(
  data: ExportJobData,
  ctx: JobContext
): Promise<{ artifactId: string; filename: string }> {
  const { documentVersionId, format, options = {} } = data;
  const { prisma, logger } = ctx;

  logger.info({ documentVersionId, format }, 'Exporting document');

  try {
    // Get document version with block outputs
    const doc = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      include: {
        blockOutputs: true,
        generationRun: {
          include: {
            template: true,
            project: true,
          },
        },
      },
    });

    if (!doc) {
      throw new Error('Document version not found');
    }

    // Build markdown content
    const markdown = buildMarkdown(doc, options);

    // Export based on format
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
    const exportId = generateId();
    let filename: string;
    let mimeType: string;
    let content: Buffer;

    switch (format) {
      case 'markdown':
        filename = `${sanitizeFilename(doc.title)}.md`;
        mimeType = 'text/markdown';
        content = Buffer.from(markdown, 'utf-8');
        break;

      case 'docx':
        filename = `${sanitizeFilename(doc.title)}.docx`;
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        content = await convertToDocx(markdown);
        break;

      case 'pdf':
        filename = `${sanitizeFilename(doc.title)}.pdf`;
        mimeType = 'application/pdf';
        content = await convertToPdf(markdown, options);
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Save file locally
    const filePath = path.join(EXPORTS_DIR, `${exportId}-${filename}`);
    await fs.writeFile(filePath, content);

    // Create artifact record
    const artifact = await prisma.artifact.create({
      data: {
        projectId: doc.generationRun.projectId,
        type: 'EXPORT',
        filename,
        originalFilename: filename,
        mimeType,
        size: BigInt(content.length),
        storageKey: `exports/${exportId}/${filename}`,
        metadata: {
          documentVersionId,
          format,
          options,
          exportedAt: new Date().toISOString(),
        },
      },
    });

    // Update document version with export artifact
    const exportArtifacts = (doc.exportArtifacts as Record<string, string>) || {};
    exportArtifacts[format] = artifact.id;

    await prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { exportArtifacts },
    });

    logger.info({ artifactId: artifact.id, filename }, 'Document exported successfully');

    return {
      artifactId: artifact.id,
      filename,
    };
  } catch (error) {
    logger.error({ error, documentVersionId, format }, 'Failed to export document');
    throw error;
  }
}

function buildMarkdown(
  doc: {
    title: string;
    blockOutputs: Array<{
      blockId: string;
      outputType: string;
      content: unknown;
      citations: unknown;
    }>;
    generationRun: {
      template: {
        templateJson: unknown;
      } | null;
    };
  },
  options: { includeTableOfContents?: boolean; includeCitations?: boolean }
): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${doc.title}`);
  lines.push('');

  // Table of contents
  if (options.includeTableOfContents) {
    lines.push('## Table of Contents');
    lines.push('');
    // TODO: Build TOC from template structure
    lines.push('');
  }

  // Content from block outputs
  for (const block of doc.blockOutputs) {
    const content = block.content as Record<string, unknown>;

    if (block.outputType === 'LLM_TEXT' && content.markdown) {
      lines.push(content.markdown as string);
      lines.push('');
    }

    if (block.outputType === 'LLM_TABLE') {
      const tableContent = content as {
        columns: Array<{ key: string; label: string }>;
        rows: Array<Record<string, unknown>>;
      };

      if (tableContent.columns && tableContent.rows) {
        // Build markdown table
        const headers = tableContent.columns.map((c) => c.label);
        const keys = tableContent.columns.map((c) => c.key);

        lines.push('| ' + headers.join(' | ') + ' |');
        lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

        for (const row of tableContent.rows) {
          const values = keys.map((k) => String(row[k] || ''));
          lines.push('| ' + values.join(' | ') + ' |');
        }
        lines.push('');
      }
    }

    // Citations
    if (options.includeCitations && block.citations) {
      const citations = block.citations as Array<{ sourceRef: string; excerpt: string }>;
      if (citations.length > 0) {
        lines.push('> **Sources:**');
        for (const citation of citations) {
          lines.push(`> - ${citation.sourceRef}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

async function convertToDocx(markdown: string): Promise<Buffer> {
  // Simple implementation using docx library
  // In production, use mammoth or pandoc for better conversion
  
  // For now, return markdown as placeholder
  // TODO: Implement proper DOCX generation
  return Buffer.from(`[DOCX conversion not implemented]\n\n${markdown}`, 'utf-8');
}

async function convertToPdf(
  markdown: string,
  options: { pageSize?: 'letter' | 'a4' }
): Promise<Buffer> {
  // In production, use puppeteer/playwright or pandoc for PDF generation
  // For now, return markdown as placeholder
  
  // TODO: Implement proper PDF generation
  return Buffer.from(`[PDF conversion not implemented]\n\n${markdown}`, 'utf-8');
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

