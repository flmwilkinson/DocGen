import { PrismaClient } from '@prisma/client';
import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from 'pino';
import { KGNode, KGEdge, KGNodeType, KGEdgeType } from '@docgen/shared';
import { generateId } from '@docgen/shared';

interface KGJobData {
  snapshotId: string;
}

interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
}

export async function processKnowledgeGraph(
  data: KGJobData,
  ctx: JobContext
): Promise<{ nodesCount: number; edgesCount: number }> {
  const { snapshotId } = data;
  const { prisma, logger } = ctx;

  try {
    // Get snapshot with local path
    const snapshot = await prisma.repoSnapshot.findUnique({
      where: { id: snapshotId },
    });

    if (!snapshot?.localPath) {
      throw new Error('Snapshot local path not found');
    }

    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: { status: 'BUILDING_KG' },
    });

    logger.info({ snapshotId, localPath: snapshot.localPath }, 'Building knowledge graph');

    const nodes: KGNode[] = [];
    const edges: KGEdge[] = [];

    // Build file/directory nodes
    const manifest = snapshot.fileManifest as Array<{
      path: string;
      language?: string;
      isDirectory: boolean;
    }>;

    for (const entry of manifest) {
      const nodeType: KGNodeType = entry.isDirectory ? 'DIRECTORY' : 'FILE';
      nodes.push({
        id: entry.path,
        type: nodeType,
        name: path.basename(entry.path),
        filePath: entry.path,
        metadata: {
          language: entry.language,
        },
      });

      // Add CONTAINS edge from parent directory
      const parentPath = path.dirname(entry.path);
      if (parentPath && parentPath !== '.') {
        edges.push({
          id: generateId(),
          from: parentPath,
          to: entry.path,
          type: 'CONTAINS',
        });
      }
    }

    // Process TypeScript/JavaScript files for symbols
    const tsFiles = manifest.filter(
      (f) => !f.isDirectory && (f.language === 'typescript' || f.language === 'javascript')
    );

    if (tsFiles.length > 0) {
      logger.info({ count: tsFiles.length }, 'Processing TypeScript/JavaScript files');
      await processTypeScriptFiles(snapshot.localPath, tsFiles, nodes, edges, logger);
    }

    // Process Python files for symbols
    const pyFiles = manifest.filter((f) => !f.isDirectory && f.language === 'python');
    
    if (pyFiles.length > 0) {
      logger.info({ count: pyFiles.length }, 'Processing Python files');
      await processPythonFiles(snapshot.localPath, pyFiles, nodes, edges, logger);
    }

    // Calculate stats
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};

    for (const node of nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }
    for (const edge of edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    // Create or update knowledge graph
    await prisma.knowledgeGraph.upsert({
      where: { repoSnapshotId: snapshotId },
      create: {
        repoSnapshotId: snapshotId,
        nodes,
        edges,
        stats: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          nodesByType,
          edgesByType,
        },
      },
      update: {
        nodes,
        edges,
        stats: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          nodesByType,
          edgesByType,
        },
        version: { increment: 1 },
      },
    });

    logger.info(
      { snapshotId, nodesCount: nodes.length, edgesCount: edges.length },
      'Knowledge graph built'
    );

    return { nodesCount: nodes.length, edgesCount: edges.length };
  } catch (error) {
    logger.error({ error, snapshotId }, 'Failed to build knowledge graph');
    throw error;
  }
}

async function processTypeScriptFiles(
  repoDir: string,
  files: Array<{ path: string }>,
  nodes: KGNode[],
  edges: KGEdge[],
  logger: Logger
) {
  try {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
      },
    });

    // Add source files
    for (const file of files.slice(0, 100)) { // Limit for performance
      const fullPath = path.join(repoDir, file.path);
      try {
        project.addSourceFileAtPath(fullPath);
      } catch {
        // Skip files that can't be parsed
      }
    }

    for (const sourceFile of project.getSourceFiles()) {
      const filePath = path.relative(repoDir, sourceFile.getFilePath());

      // Extract classes
      for (const cls of sourceFile.getClasses()) {
        const name = cls.getName();
        if (!name) continue;

        const nodeId = `${filePath}#${name}`;
        nodes.push({
          id: nodeId,
          type: 'CLASS',
          name,
          filePath,
          symbol: name,
          metadata: {
            startLine: cls.getStartLineNumber(),
            endLine: cls.getEndLineNumber(),
            isExported: cls.isExported(),
          },
        });

        edges.push({
          id: generateId(),
          from: filePath,
          to: nodeId,
          type: 'DEFINES',
        });

        // Check for extends
        const baseClass = cls.getBaseClass();
        if (baseClass) {
          edges.push({
            id: generateId(),
            from: nodeId,
            to: `${baseClass.getSourceFile().getFilePath()}#${baseClass.getName()}`,
            type: 'EXTENDS',
          });
        }
      }

      // Extract functions
      for (const func of sourceFile.getFunctions()) {
        const name = func.getName();
        if (!name) continue;

        const nodeId = `${filePath}#${name}`;
        nodes.push({
          id: nodeId,
          type: 'FUNCTION',
          name,
          filePath,
          symbol: name,
          metadata: {
            startLine: func.getStartLineNumber(),
            endLine: func.getEndLineNumber(),
            isExported: func.isExported(),
            signature: func.getSignature()?.getDeclaration().getText().slice(0, 200),
          },
        });

        edges.push({
          id: generateId(),
          from: filePath,
          to: nodeId,
          type: 'DEFINES',
        });
      }

      // Extract imports
      for (const imp of sourceFile.getImportDeclarations()) {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        
        // Try to resolve to actual file
        let targetPath = moduleSpecifier;
        if (moduleSpecifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(sourceFile.getFilePath()), moduleSpecifier);
          targetPath = path.relative(repoDir, resolved);
        }

        edges.push({
          id: generateId(),
          from: filePath,
          to: targetPath,
          type: 'IMPORTS',
          metadata: {
            importType: imp.getDefaultImport() ? 'default' : 'named',
            importedSymbols: imp.getNamedImports().map((n) => n.getName()),
          },
        });
      }
    }
  } catch (error) {
    logger.warn({ error }, 'Error processing TypeScript files');
  }
}

async function processPythonFiles(
  repoDir: string,
  files: Array<{ path: string }>,
  nodes: KGNode[],
  edges: KGEdge[],
  logger: Logger
) {
  // Simple regex-based extraction for Python
  // TODO: Use Python AST parser for better accuracy
  
  const classRegex = /^class\s+(\w+)/gm;
  const funcRegex = /^def\s+(\w+)/gm;
  const importRegex = /^(?:from\s+([\w.]+)\s+)?import\s+([\w,\s*]+)/gm;

  for (const file of files.slice(0, 100)) {
    const fullPath = path.join(repoDir, file.path);
    
    try {
      const content = await fs.readFile(fullPath, 'utf-8');

      // Extract classes
      let match;
      while ((match = classRegex.exec(content)) !== null) {
        const name = match[1];
        const nodeId = `${file.path}#${name}`;
        
        nodes.push({
          id: nodeId,
          type: 'CLASS',
          name,
          filePath: file.path,
          symbol: name,
          metadata: { language: 'python' },
        });

        edges.push({
          id: generateId(),
          from: file.path,
          to: nodeId,
          type: 'DEFINES',
        });
      }

      // Extract functions
      classRegex.lastIndex = 0;
      while ((match = funcRegex.exec(content)) !== null) {
        const name = match[1];
        if (name.startsWith('_') && name !== '__init__') continue; // Skip private

        const nodeId = `${file.path}#${name}`;
        
        nodes.push({
          id: nodeId,
          type: 'FUNCTION',
          name,
          filePath: file.path,
          symbol: name,
          metadata: { language: 'python' },
        });

        edges.push({
          id: generateId(),
          from: file.path,
          to: nodeId,
          type: 'DEFINES',
        });
      }

      // Extract imports
      funcRegex.lastIndex = 0;
      while ((match = importRegex.exec(content)) !== null) {
        const fromModule = match[1] || match[2].trim();
        
        edges.push({
          id: generateId(),
          from: file.path,
          to: fromModule,
          type: 'IMPORTS',
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }
}

