import { z } from 'zod';

// ===========================================
// Knowledge Graph Node Types
// ===========================================

export const KGNodeTypeEnum = z.enum([
  'FILE',
  'DIRECTORY',
  'MODULE',
  'CLASS',
  'FUNCTION',
  'METHOD',
  'VARIABLE',
  'INTERFACE',
  'TYPE',
  'ENUM',
  'IMPORT',
  'EXPORT',
  'COMPONENT', // React/Vue components
  'ROUTE', // API routes
  'CONFIG',
  'TEST',
]);

export type KGNodeType = z.infer<typeof KGNodeTypeEnum>;

// ===========================================
// Knowledge Graph Edge Types
// ===========================================

export const KGEdgeTypeEnum = z.enum([
  'CONTAINS', // Directory contains file, file contains class
  'IMPORTS', // File imports from another
  'EXPORTS', // File exports symbol
  'EXTENDS', // Class extends another
  'IMPLEMENTS', // Class implements interface
  'CALLS', // Function calls another function
  'USES', // Variable/type usage
  'DEPENDS_ON', // Generic dependency
  'TESTS', // Test file tests source file
  'DEFINES', // File defines symbol
  'REFERENCES', // Generic reference
]);

export type KGEdgeType = z.infer<typeof KGEdgeTypeEnum>;

// ===========================================
// Knowledge Graph Node
// ===========================================

export const KGNodeMetadataSchema = z.object({
  // Common
  language: z.string().optional(),
  documentation: z.string().optional(),
  
  // Location
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
  startColumn: z.number().int().optional(),
  endColumn: z.number().int().optional(),
  
  // File-specific
  size: z.number().int().optional(),
  extension: z.string().optional(),
  
  // Symbol-specific
  signature: z.string().optional(),
  returnType: z.string().optional(),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.string().optional(),
    optional: z.boolean().optional(),
  })).optional(),
  
  // Class-specific
  isAbstract: z.boolean().optional(),
  isExported: z.boolean().optional(),
  visibility: z.enum(['public', 'private', 'protected']).optional(),
  
  // Component-specific (React)
  props: z.array(z.object({
    name: z.string(),
    type: z.string().optional(),
    required: z.boolean().optional(),
  })).optional(),
  
  // Test-specific
  testType: z.enum(['unit', 'integration', 'e2e']).optional(),
  
  // Custom
  tags: z.array(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
});

export type KGNodeMetadata = z.infer<typeof KGNodeMetadataSchema>;

export const KGNodeSchema = z.object({
  id: z.string(),
  type: KGNodeTypeEnum,
  name: z.string(),
  filePath: z.string().optional(),
  symbol: z.string().optional(), // Fully qualified symbol name
  metadata: KGNodeMetadataSchema.optional(),
});

export type KGNode = z.infer<typeof KGNodeSchema>;

// ===========================================
// Knowledge Graph Edge
// ===========================================

export const KGEdgeMetadataSchema = z.object({
  // Import-specific
  importType: z.enum(['default', 'named', 'namespace', 'side-effect']).optional(),
  importedSymbols: z.array(z.string()).optional(),
  
  // Call-specific
  callSite: z.object({
    line: z.number().int(),
    column: z.number().int().optional(),
  }).optional(),
  
  // Reference count
  count: z.number().int().optional(),
  
  // Confidence (for heuristic edges)
  confidence: z.number().min(0).max(1).optional(),
});

export type KGEdgeMetadata = z.infer<typeof KGEdgeMetadataSchema>;

export const KGEdgeSchema = z.object({
  id: z.string(),
  from: z.string(), // Node ID
  to: z.string(), // Node ID
  type: KGEdgeTypeEnum,
  metadata: KGEdgeMetadataSchema.optional(),
});

export type KGEdge = z.infer<typeof KGEdgeSchema>;

// ===========================================
// Knowledge Graph (Full)
// ===========================================

export const KnowledgeGraphSchema = z.object({
  id: z.string().uuid(),
  repoSnapshotId: z.string().uuid(),
  version: z.number().int().positive().default(1),
  nodes: z.array(KGNodeSchema),
  edges: z.array(KGEdgeSchema),
  stats: z.object({
    totalNodes: z.number().int().nonnegative(),
    totalEdges: z.number().int().nonnegative(),
    nodesByType: z.record(z.number().int().nonnegative()),
    edgesByType: z.record(z.number().int().nonnegative()),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

// ===========================================
// KG Query Types
// ===========================================

export const KGQueryResultSchema = z.object({
  nodes: z.array(KGNodeSchema),
  edges: z.array(KGEdgeSchema),
  paths: z.array(z.array(z.string())).optional(), // For path queries
});

export type KGQueryResult = z.infer<typeof KGQueryResultSchema>;

// ===========================================
// Repo Overview (Summary for LLM context)
// ===========================================

export const RepoOverviewSchema = z.object({
  summary: z.string(),
  mainLanguages: z.array(z.object({
    language: z.string(),
    percentage: z.number(),
  })),
  structure: z.object({
    topLevelDirs: z.array(z.string()),
    entryPoints: z.array(z.string()),
    configFiles: z.array(z.string()),
    testDirectories: z.array(z.string()),
  }),
  keyComponents: z.array(z.object({
    name: z.string(),
    type: z.string(),
    path: z.string(),
    description: z.string().optional(),
  })),
  dependencies: z.object({
    runtime: z.array(z.string()),
    dev: z.array(z.string()),
  }).optional(),
});

export type RepoOverview = z.infer<typeof RepoOverviewSchema>;

// ===========================================
// Helper Functions
// ===========================================

export function createNodeId(filePath: string, symbol?: string): string {
  if (symbol) {
    return `${filePath}#${symbol}`;
  }
  return filePath;
}

export function parseNodeId(nodeId: string): { filePath: string; symbol?: string } {
  const parts = nodeId.split('#');
  return {
    filePath: parts[0],
    symbol: parts[1],
  };
}

export function getNodesByType(kg: KnowledgeGraph, type: KGNodeType): KGNode[] {
  return kg.nodes.filter((n) => n.type === type);
}

export function getOutgoingEdges(kg: KnowledgeGraph, nodeId: string): KGEdge[] {
  return kg.edges.filter((e) => e.from === nodeId);
}

export function getIncomingEdges(kg: KnowledgeGraph, nodeId: string): KGEdge[] {
  return kg.edges.filter((e) => e.to === nodeId);
}

export function getConnectedNodes(kg: KnowledgeGraph, nodeId: string): KGNode[] {
  const connectedIds = new Set<string>();
  for (const edge of kg.edges) {
    if (edge.from === nodeId) connectedIds.add(edge.to);
    if (edge.to === nodeId) connectedIds.add(edge.from);
  }
  return kg.nodes.filter((n) => connectedIds.has(n.id));
}

