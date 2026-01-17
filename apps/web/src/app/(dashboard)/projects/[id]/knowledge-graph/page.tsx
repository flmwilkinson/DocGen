'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ChevronRight,
  File,
  Folder,
  Box,
  FunctionSquare,
  Search,
  Filter,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/store/projects';
import { buildCodeIntelligence, type CodeIntelligenceResult, type CodeChunk, type CodeRelationship } from '@/lib/code-intelligence';
import { getCachedKnowledgeBase, getCachedCodeIntelligence, serializeCodeIntelligence } from '@/lib/github-cache';
import { useSession } from 'next-auth/react';
import { getGitHubTokenFromSession } from '@/lib/github-auth';
import OpenAI from 'openai';

const nodeColors: Record<string, string> = {
  DIRECTORY: '#6366f1',
  FILE: '#10b981',
  CLASS: '#f59e0b',
  FUNCTION: '#ec4899',
  MODULE: '#8b5cf6',
  INTERFACE: '#06b6d4',
  CONSTANT: '#14b8a6',
  CONFIG: '#a855f7',
};

const edgeColors: Record<string, string> = {
  CONTAINS: '#475569',
  DECLARES: '#64748b',
  IMPORTS: '#f59e0b',
  CALLS: '#ec4899',
  EXTENDS: '#10b981',
  IMPLEMENTS: '#10b981',
  USES: '#6366f1',
  EXPORTS: '#8b5cf6',
};

const nodeIcons: Record<string, React.ReactNode> = {
  DIRECTORY: <Folder className="h-4 w-4" />,
  FILE: <File className="h-4 w-4" />,
  CLASS: <Box className="h-4 w-4" />,
  FUNCTION: <FunctionSquare className="h-4 w-4" />,
};

function KnowledgeGraphContent() {
  const params = useParams();
  const projectId = params.id as string;
  const project = useProjectsStore((state) => state.getProject(projectId));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [activeEdgeTypes, setActiveEdgeTypes] = useState<Set<string>>(new Set());
  const [kgData, setKgData] = useState<CodeIntelligenceResult | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<CodeKnowledgeBase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoUpdated, setRepoUpdated] = useState(false);
  const [wasCached, setWasCached] = useState(false);
  const [debugSteps, setDebugSteps] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState<string>('');
  const updateProject = useProjectsStore((state) => state.updateProject);
  const { data: session } = useSession();
  const { fitView } = useReactFlow();
  
  const addDebugStep = useCallback((step: string) => {
    console.log('[KG Debug]', step);
    setDebugSteps(prev => [...prev, `${new Date().toLocaleTimeString()}: ${step}`]);
    setCurrentStep(step);
  }, []);

  // Load knowledge graph from actual repo
  const loadKnowledgeGraph = useCallback(async (forceRefresh: boolean = false) => {
    if (!project?.repoUrl) {
      setError('No GitHub repository connected to this project. Please add a GitHub URL to your project.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setDebugSteps([]);
      setCurrentStep('Initializing...');
      
      addDebugStep(`Starting knowledge graph build for: ${project.repoUrl}`);
      addDebugStep(`Force refresh: ${forceRefresh}`);
      addDebugStep(`Has cached data: ${!!project.cachedKnowledgeBase}`);
      addDebugStep(`Last commit hash: ${project.lastCommitHash || 'none'}`);
      
      // Get OpenAI client (needed for buildCodeIntelligence)
      addDebugStep('Checking OpenAI API key...');
      const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      if (!apiKey || apiKey === 'sk-...' || apiKey.includes('...')) {
        throw new Error('OpenAI API key not configured. Please add NEXT_PUBLIC_OPENAI_API_KEY to your .env.local file and restart the dev server.');
      }
      addDebugStep('OpenAI API key found');
      
      const openaiClient = new OpenAI({ 
        apiKey,
        dangerouslyAllowBrowser: true,
      });
      
      const githubToken = getGitHubTokenFromSession(session);
      addDebugStep(`GitHub OAuth token: ${githubToken ? 'present' : 'missing'}`);

      // Run server-side GitHub access diagnostics
      try {
        const debugRes = await fetch(
          `/api/github/debug?repoUrl=${encodeURIComponent(project.repoUrl)}`
        );
        const debugJson = await debugRes.json();
        addDebugStep(
          `GitHub debug: token=${debugJson.hasToken ? 'yes' : 'no'}, ` +
          `user=${debugJson.userLogin || 'none'}, ` +
          `repoStatus=${debugJson.repoStatus || 'n/a'}`
        );
        if (debugJson.userScopes) {
          addDebugStep(`GitHub scopes: ${debugJson.userScopes}`);
        }
        if (debugJson.repoError) {
          addDebugStep(`GitHub repo error: ${debugJson.repoError}`);
        }
        if (debugJson.userError) {
          addDebugStep(`GitHub user error: ${debugJson.userError}`);
        }
      } catch (error: any) {
        addDebugStep(`GitHub debug failed: ${error?.message || 'unknown error'}`);
      }

      // Get cached or fresh knowledge base
      addDebugStep('Step 1: Checking cache and fetching knowledge base...');
      const { knowledgeBase, wasCached: kbCached, commitHash } = await getCachedKnowledgeBase(
        project.repoUrl,
        project.lastCommitHash,
        project.cachedKnowledgeBase,
        (msg) => {
          addDebugStep(`KB: ${msg}`);
          setCurrentStep(msg);
        },
        forceRefresh,
        githubToken
      );
      setKnowledgeBase(knowledgeBase);
      
      setWasCached(kbCached);
      setRepoUpdated(commitHash !== project.lastCommitHash && commitHash !== null);
      
      addDebugStep(`Knowledge base loaded: ${knowledgeBase.files.length} files, cached: ${kbCached}`);
      addDebugStep(`Commit hash: ${commitHash ? commitHash.substring(0, 7) : 'unknown'}`);
      
      if (knowledgeBase.files.length === 0) {
        throw new Error('No source code files found in repository. Make sure the repository contains code files (Python, TypeScript, JavaScript, etc.)');
      }
      
      // Get cached or fresh code intelligence
      addDebugStep('Step 2: Building code intelligence (parsing chunks and relationships)...');
      setCurrentStep('Parsing code into semantic chunks...');
      const { codeIntelligence, wasCached: ciCached } = await getCachedCodeIntelligence(
        knowledgeBase,
        project.cachedCodeIntelligence,
        openaiClient,
        kbCached && !forceRefresh,
        (msg) => {
          addDebugStep(`CI: ${msg}`);
          setCurrentStep(msg);
        }
      );
      
      addDebugStep(`Code intelligence built: ${codeIntelligence.chunks.length} chunks, ${codeIntelligence.relationships.length} relationships`);
      addDebugStep(`Cached: ${ciCached}`);
      
      if (codeIntelligence.chunks.length === 0) {
        throw new Error('No code chunks found. The repository might not contain parseable code files.');
      }
      
      setKgData(codeIntelligence);
      setCurrentStep('Complete!');
      
      // Update project with cached data if it was fresh
      if (!kbCached || !ciCached || forceRefresh) {
        addDebugStep('Updating project cache...');
        updateProject(projectId, {
          lastCommitHash: commitHash || undefined,
          lastKnowledgeGraphUpdate: new Date(),
          cachedKnowledgeBase: knowledgeBase,
          cachedCodeIntelligence: serializeCodeIntelligence(codeIntelligence),
        });
        addDebugStep('Cache updated successfully');
      }
      
      addDebugStep('Knowledge graph loaded successfully!');
      console.log('[KG] Knowledge graph loaded successfully!');
    } catch (err) {
      console.error('[KG] Error loading knowledge graph:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load knowledge graph';
      addDebugStep(`ERROR: ${errorMessage}`);
      
      // Log detailed error for debugging
      if (err instanceof Error) {
        console.error('[KG] Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
        });
        addDebugStep(`Error type: ${err.name}`);
        if (err.stack) {
          addDebugStep(`Stack: ${err.stack.split('\n')[0]}`);
        }
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
      setCurrentStep('');
    }
  }, [project?.repoUrl, projectId, updateProject, addDebugStep]);

  // Load knowledge graph on mount or when project changes
  useEffect(() => {
    if (project?.repoUrl) {
      loadKnowledgeGraph(false);
    }
  }, [project?.repoUrl, loadKnowledgeGraph]);

  // Convert KG data to React Flow format
  const { flowNodes, flowEdges, edgeTypeStats, allFlowEdges } = useMemo(() => {
    // Use real data if available, otherwise use empty arrays
    if (!kgData) {
      return { flowNodes: [], flowEdges: [] };
    }

    // Convert code chunks to nodes
    const chunkNodes: Array<{ id: string; chunk: CodeChunk; depth: number }> = [];
    const fileNodes: Map<string, { id: string; path: string; depth: number }> = new Map();
    const dirNodes: Map<string, { id: string; path: string; depth: number }> = new Map();
    
    // First pass: create file and directory nodes from knowledge base (full repo coverage)
    const allFilePaths = new Set<string>();
    if (knowledgeBase?.files?.length) {
      knowledgeBase.files.forEach((file) => {
        allFilePaths.add(file.path);
      });
    }
    kgData.chunks.forEach((chunk) => allFilePaths.add(chunk.filePath));

    allFilePaths.forEach((filePath) => {
      const pathParts = filePath.split('/');
      for (let i = 0; i < pathParts.length - 1; i++) {
        const dirPath = pathParts.slice(0, i + 1).join('/');
        if (!dirNodes.has(dirPath)) {
          dirNodes.set(dirPath, {
            id: `dir:${dirPath}`,
            path: dirPath,
            depth: i,
          });
        }
      }
      if (!fileNodes.has(filePath)) {
        fileNodes.set(filePath, {
          id: `file:${filePath}`,
          path: filePath,
          depth: pathParts.length - 1,
        });
      }
    });

    // Create chunk nodes (functions/classes/modules)
    kgData.chunks.forEach((chunk) => {
      const pathParts = chunk.filePath.split('/');
      chunkNodes.push({
        id: chunk.id,
        chunk,
        depth: pathParts.length,
      });
    });

    // Build deterministic positions (grid layout per depth)
    const nodePositions: Record<string, { x: number; y: number }> = {};

    const layoutByDepth = (
      idsByDepth: Record<number, string[]>,
      startY: number,
      spacingX: number,
      spacingY: number,
      maxPerRow: number
    ) => {
      Object.entries(idsByDepth).forEach(([depthStr, ids]) => {
        const depth = Number(depthStr);
        const rows = Math.ceil(ids.length / maxPerRow);
        const rowOffsetY = startY + depth * spacingY;
        ids.forEach((id, index) => {
          const row = Math.floor(index / maxPerRow);
          const col = index % maxPerRow;
          const x = (col - Math.min(maxPerRow, ids.length) / 2) * spacingX + 400;
          const y = rowOffsetY + row * (spacingY * 0.6);
          nodePositions[id] = { x, y };
        });
        // Nudge to keep rows centered vertically for each depth
        if (rows > 1) {
          ids.forEach((id, index) => {
            const row = Math.floor(index / maxPerRow);
            nodePositions[id].y -= (rows - 1) * (spacingY * 0.3) / 2;
          });
        }
      });
    };

    // Position directories
    const dirsByDepth: Record<number, string[]> = {};
    dirNodes.forEach((node) => {
      if (!dirsByDepth[node.depth]) dirsByDepth[node.depth] = [];
      dirsByDepth[node.depth].push(node.id);
    });
    layoutByDepth(dirsByDepth, 40, 220, 140, 8);

    // Position files
    const filesByDepth: Record<number, string[]> = {};
    fileNodes.forEach((node) => {
      if (!filesByDepth[node.depth]) filesByDepth[node.depth] = [];
      filesByDepth[node.depth].push(node.id);
    });
    layoutByDepth(filesByDepth, 120, 200, 150, 7);

    // Position chunks (classes, functions) under their file
    const chunksByFile: Record<string, CodeChunk[]> = {};
    chunkNodes.forEach(({ chunk }) => {
      if (!chunksByFile[chunk.filePath]) chunksByFile[chunk.filePath] = [];
      chunksByFile[chunk.filePath].push(chunk);
    });

    chunkNodes.forEach(({ id, chunk }) => {
      const fileNode = fileNodes.get(chunk.filePath);
      const fileChunks = chunksByFile[chunk.filePath] || [];
      if (!fileNode) return;
      const filePos = nodePositions[fileNode.id];
      const index = fileChunks.indexOf(chunk);
      const perRow = 3;
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      nodePositions[id] = {
        x: filePos.x + (col - (perRow - 1) / 2) * 180,
        y: filePos.y + 120 + row * 100,
      };
    });

    // Create React Flow nodes
    const allFlowNodes: Node[] = [
      // Directory nodes
      ...Array.from(dirNodes.values()).map((node) => ({
        id: node.id,
        type: 'custom',
        position: nodePositions[node.id] || { x: 0, y: 0 },
        data: {
          label: node.path.split('/').pop() || node.path,
          nodeType: 'DIRECTORY',
          filePath: node.path,
          metadata: {},
        },
      })),
      // File nodes
      ...Array.from(fileNodes.values()).map((node) => {
        const kbFile = knowledgeBase?.files?.find((f) => f.path === node.path);
        return ({
        id: node.id,
        type: 'custom',
        position: nodePositions[node.id] || { x: 0, y: 0 },
        data: {
          label: node.path.split('/').pop() || node.path,
          nodeType: 'FILE',
          filePath: node.path,
          metadata: { language: kbFile?.language || kgData.chunks.find(c => c.filePath === node.path)?.language },
        },
      });
      }),
      // Chunk nodes (classes, functions)
      ...chunkNodes.map(({ id, chunk }) => ({
        id,
        type: 'custom',
        position: nodePositions[id] || { x: 0, y: 0 },
        data: {
          label: chunk.name,
          nodeType: chunk.type.toUpperCase() as string,
          filePath: chunk.filePath,
          metadata: {
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
            signature: chunk.signature,
          },
        },
      })),
    ].filter((node) => {
      // Apply filters
      if (searchQuery && !node.data.label.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (filterTypes.size > 0 && !filterTypes.has(node.data.nodeType)) {
        return false;
      }
      return true;
    });

    // Create React Flow edges
    const visibleNodeIds = new Set(allFlowNodes.map((n) => n.id));
    const fileNodeList = Array.from(fileNodes.values());
    const resolveNodeId = (ref: string): string | null => {
      // Chunk ID or file path exact match
      const directChunk = kgData.chunks.find(c => c.id === ref || c.filePath === ref);
      if (directChunk) return directChunk.id;
      const directFile = fileNodes.get(ref);
      if (directFile) return directFile.id;

      // Normalize import-style paths
      const cleaned = ref
        .replace(/^[@~]\//, '')
        .replace(/^\.\//, '')
        .replace(/^\.\.\//, '')
        .replace(/\\/g, '/');
      const cleanedNoExt = cleaned.replace(/\.[^/.]+$/, '');

      // Try to match to file paths
      for (const node of fileNodeList) {
        const fileNoExt = node.path.replace(/\.[^/.]+$/, '');
        if (node.path.endsWith(cleaned) || fileNoExt.endsWith(cleanedNoExt)) {
          return node.id;
        }
        if (fileNoExt.endsWith(`${cleanedNoExt}/index`)) {
          return node.id;
        }
      }

      // Try to match to chunk name
      const chunkByName = kgData.chunks.find(c => c.name === cleanedNoExt);
      if (chunkByName) return chunkByName.id;
      
      return null;
    };

    const structuralEdges: Edge[] = [];
    const addStructuralEdge = (id: string, source: string, target: string, label: string, color: string) => {
      if (!visibleNodeIds.has(source) || !visibleNodeIds.has(target)) return;
      structuralEdges.push({
        id,
        source,
        target,
        type: 'smoothstep',
        animated: false,
        data: { edgeType: label, category: 'structure' },
        style: {
          stroke: color,
          strokeWidth: 2.5,
          opacity: 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: color,
        },
        label,
        labelStyle: {
          fontSize: 10,
          fill: '#ffffff',
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: color,
          fillOpacity: 0.85,
          stroke: color,
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        },
        labelBgPadding: [3, 5],
      });
    };

    // Directory -> File edges
    fileNodeList.forEach((fileNode) => {
      const pathParts = fileNode.path.split('/');
      if (pathParts.length < 2) return;
      const parentPath = pathParts.slice(0, -1).join('/');
      const dirNode = dirNodes.get(parentPath);
      if (!dirNode) return;
      addStructuralEdge(
        `edge-dir-${dirNode.id}-${fileNode.id}`,
        dirNode.id,
        fileNode.id,
        'CONTAINS',
        '#475569'
      );
    });

    // File -> Chunk edges
    chunkNodes.forEach(({ id, chunk }) => {
      const fileNode = fileNodes.get(chunk.filePath);
      if (!fileNode) return;
      addStructuralEdge(
        `edge-file-${fileNode.id}-${id}`,
        fileNode.id,
        id,
        'DECLARES',
        '#64748b'
      );
    });

    const relationshipEdges: Edge[] = kgData.relationships
      .map((rel): Edge | null => {
        // Map relationship to node IDs
        const sourceId = resolveNodeId(rel.from);
        const targetId = resolveNodeId(rel.to);
        
        if (!sourceId || !targetId || !visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) {
          return null;
        }
        
        const edgeTypeMap: Record<string, string> = {
          imports: 'IMPORTS',
          calls: 'CALLS',
          extends: 'EXTENDS',
          implements: 'IMPLEMENTS',
          uses: 'USES',
          exports: 'EXPORTS',
        };
        
        const edgeType = edgeTypeMap[rel.type] || rel.type.toUpperCase();
        const color = edgeColors[edgeType] || '#6b7280';
        
        return {
          id: `edge-${sourceId}-${targetId}-${rel.type}`,
          source: sourceId,
          target: targetId,
          type: edgeType === 'IMPORTS' ? 'smoothstep' : 'straight',
          animated: edgeType === 'IMPORTS' || edgeType === 'CALLS',
          data: { edgeType, category: 'relationship' },
          style: {
            stroke: color,
            strokeWidth: edgeType === 'IMPORTS' ? 3.2 : edgeType === 'CALLS' ? 2.8 : 2.4,
            opacity: 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 25,
            height: 25,
            color: color,
          },
          label: edgeType,
          labelStyle: { 
            fontSize: 11, 
            fill: '#ffffff',
            fontWeight: 700,
          },
          labelBgStyle: {
            fill: color,
            fillOpacity: 0.9,
            stroke: color,
            strokeWidth: 1,
            rx: 4,
            ry: 4,
          },
          labelBgPadding: [4, 6],
        };
      })
      .filter((e): e is Edge => e !== null);

    const allFlowEdges = [...structuralEdges, ...relationshipEdges];
    const edgeStats: Record<string, number> = {};
    allFlowEdges.forEach((edge) => {
      const type = (edge.data as { edgeType?: string })?.edgeType || edge.label?.toString() || 'UNKNOWN';
      edgeStats[type] = (edgeStats[type] || 0) + 1;
    });
    const filteredEdges = activeEdgeTypes.size
      ? allFlowEdges.filter((edge) => {
          const type = (edge.data as { edgeType?: string })?.edgeType || edge.label?.toString() || 'UNKNOWN';
          return activeEdgeTypes.has(type);
        })
      : allFlowEdges;

    return { flowNodes: allFlowNodes, flowEdges: filteredEdges, edgeTypeStats: edgeStats, allFlowEdges };
  }, [kgData, searchQuery, filterTypes, activeEdgeTypes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Update nodes and edges when flowNodes/flowEdges change
  useEffect(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  // Initialize edge filters on first load
  useEffect(() => {
    if (activeEdgeTypes.size > 0) return;
    const edgeTypes = Object.keys(edgeTypeStats || {});
    if (edgeTypes.length > 0) {
      setActiveEdgeTypes(new Set(edgeTypes));
    }
  }, [edgeTypeStats, activeEdgeTypes.size]);

  // Apply a lightweight force layout so nodes re-space after filtering
  // Physics removed in favor of deterministic layout (prevents crossovers)


  const displayNodes = useMemo(() => {
    const focusId = hoveredNode || selectedNode;
    if (!focusId) {
      return nodes.map((n) => ({
        ...n,
        style: { ...n.style, opacity: 1 },
      }));
    }
    const connected = new Set<string>([focusId]);
    edges.forEach((e) => {
      if (e.source === focusId || e.target === focusId) {
        connected.add(e.source);
        connected.add(e.target);
      }
    });
    return nodes.map((n) => ({
      ...n,
      style: {
        ...n.style,
        opacity: connected.has(n.id) ? 1 : 0.15,
      },
    }));
  }, [nodes, edges, hoveredNode, selectedNode]);

  const displayEdges = useMemo(() => {
    const focusId = hoveredNode || selectedNode;
    const isFocused = (e: Edge) => !focusId || e.source === focusId || e.target === focusId;
    return edges.map((e) => {
      const focused = isFocused(e);
      return {
        ...e,
        style: {
          ...e.style,
          opacity: focused ? 1 : 0.08,
        },
        labelStyle: {
          ...(e.labelStyle || {}),
          opacity: focused ? 1 : 0,
        },
        labelBgStyle: {
          ...(e.labelBgStyle || {}),
          fillOpacity: focused ? 0.9 : 0,
          opacity: focused ? 1 : 0,
        },
      };
    });
  }, [edges, hoveredNode, selectedNode]);

  // Auto-fit after layout/filter changes
  useEffect(() => {
    if (nodes.length === 0) return;
    const timeout = setTimeout(() => {
      fitView({ padding: 0.45, maxZoom: 1, minZoom: 0.05 });
    }, 80);
    return () => clearTimeout(timeout);
  }, [nodes.length, edges.length, fitView]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode((prev) => (prev === node.id ? null : node.id));
  }, []);

  const toggleFilter = (type: string) => {
    const newFilters = new Set(filterTypes);
    if (newFilters.has(type)) {
      newFilters.delete(type);
    } else {
      newFilters.add(type);
    }
    setFilterTypes(newFilters);
  };

  const toggleEdgeFilter = (type: string) => {
    const newFilters = new Set(activeEdgeTypes);
    if (newFilters.has(type)) {
      newFilters.delete(type);
    } else {
      newFilters.add(type);
    }
    setActiveEdgeTypes(newFilters);
  };

  // Get selected node data
  const selectedNodeData = selectedNode 
    ? (() => {
        const flowNode = displayNodes.find((n) => n.id === selectedNode)
          || nodes.find((n) => n.id === selectedNode)
          || flowNodes.find((n) => n.id === selectedNode);
        if (flowNode) {
          return {
            id: flowNode.id,
            name: flowNode.data.label,
            type: flowNode.data.nodeType,
            filePath: flowNode.data.filePath,
            metadata: flowNode.data.metadata,
          };
        }
        return null;
      })()
    : null;

  // Calculate stats from real data
  const stats = useMemo(() => {
    if (!kgData) return { totalNodes: 0, totalEdges: 0, nodesByType: {} };
    
    const nodesByType: Record<string, number> = {};
    kgData.chunks.forEach(chunk => {
      const type = chunk.type.toUpperCase();
      nodesByType[type] = (nodesByType[type] || 0) + 1;
    });
    nodesByType['FILE'] = new Set(kgData.chunks.map(c => c.filePath)).size;
    nodesByType['DIRECTORY'] = new Set(
      kgData.chunks.flatMap(c => {
        const parts = c.filePath.split('/');
        return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
      })
    ).size;
    
    const edgeCount = edgeTypeStats
      ? Object.values(edgeTypeStats).reduce((sum, count) => sum + count, 0)
      : kgData.relationships.length;

    return {
      totalNodes: kgData.chunks.length + nodesByType['FILE'] + nodesByType['DIRECTORY'],
      totalEdges: edgeCount,
      nodesByType,
    };
  }, [kgData, edgeTypeStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] p-6">
        <div className="text-center max-w-2xl w-full">
          <Loader2 className="h-12 w-12 animate-spin text-brand-orange mx-auto mb-4" />
          <h2 className="text-lg font-medium mb-2">Building Knowledge Graph</h2>
          <p className="text-sm text-muted-foreground mb-4">{currentStep || 'Analyzing repository structure...'}</p>
          
          {/* Debug Steps */}
          {debugSteps.length > 0 && (
            <div className="mt-6 bg-glass-bg p-4 rounded-lg border border-glass-border text-left">
              <p className="text-sm font-semibold mb-2">Progress Steps:</p>
              <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                {debugSteps.map((step, idx) => (
                  <div key={idx} className="text-xs font-mono text-muted-foreground">
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] p-6">
        <div className="text-center max-w-2xl">
          <div className="glass-panel p-8 rounded-xl">
            <h2 className="text-xl font-bold mb-4 text-red-400">Knowledge Graph Error</h2>
            <p className="text-foreground/90 mb-6">{error}</p>
            <div className="text-left bg-glass-bg p-4 rounded-lg mb-6">
              <p className="text-sm font-semibold mb-2">Troubleshooting:</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Check that your project has a valid GitHub repository URL</li>
                <li>Ensure the repository is public or you have access</li>
                <li>Verify your OpenAI API key is configured in .env.local</li>
                <li>Check the browser console for detailed error messages</li>
                <li>Make sure the repository contains source code files</li>
              </ul>
            </div>
            <div className="flex gap-4 justify-center">
              <Link 
                href={`/projects/${projectId}`} 
                className="btn-secondary"
              >
                Back to project
              </Link>
              <button
                onClick={() => {
                  setError(null);
                  loadKnowledgeGraph(true); // Force refresh
                }}
                className="btn-primary"
              >
                Retry (Force Refresh)
              </button>
            </div>
            
            {/* Debug Steps */}
            {debugSteps.length > 0 && (
              <div className="mt-6 bg-glass-bg p-4 rounded-lg border border-glass-border text-left">
                <p className="text-sm font-semibold mb-2">Debug Steps:</p>
                <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                  {debugSteps.map((step, idx) => (
                    <div key={idx} className="text-xs font-mono text-muted-foreground">
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!kgData) {
    // Still loading or failed - error state is handled above
    return null;
  }

  if (flowNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] p-6">
        <div className="text-center max-w-2xl">
          <div className="glass-panel p-8 rounded-xl">
            <h2 className="text-xl font-bold mb-4">No Nodes Found</h2>
            <p className="text-foreground/90 mb-6">
              The knowledge graph was built successfully ({kgData.chunks.length} chunks, {kgData.relationships.length} relationships),
              but no nodes match your current filters.
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterTypes(new Set());
                }}
                className="btn-primary"
              >
                Clear Filters
              </button>
              <Link 
                href={`/projects/${projectId}`} 
                className="btn-secondary"
              >
                Back to project
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-6">
      {/* Main Graph View */}
      <div className="flex-1">
        <div className="glass-panel h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-glass-border p-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Link href={`/projects/${params.id}`} className="hover:text-foreground">
                  Project
                </Link>
                <ChevronRight className="h-4 w-4" />
                <span>Knowledge Graph</span>
              </div>
              <h1 className="text-xl font-bold">Repository Knowledge Graph</h1>
            </div>
            
            {/* Search + Actions */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => fitView({ padding: 0.4, maxZoom: 1, minZoom: 0.1 })}
                className="btn-secondary"
              >
                Reset View
              </button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search nodes..."
                  className="input-glass w-64 pl-10"
                />
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-2 border-b border-glass-border px-4 py-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground mr-2">Filter:</span>
            {Object.entries(stats.nodesByType).map(([type, count]) => (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors',
                  filterTypes.has(type) || filterTypes.size === 0
                    ? 'bg-glass-bg text-foreground'
                    : 'text-muted-foreground opacity-50'
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: nodeColors[type] || '#6b7280' }}
                />
                {type} ({count})
              </button>
            ))}
          </div>

          {/* Edge Filter Bar */}
          <div className="flex items-center gap-2 border-b border-glass-border px-4 py-2">
            <span className="text-sm text-muted-foreground mr-2">Edges:</span>
            {Object.entries(edgeTypeStats || {}).map(([type, count]) => (
              <button
                key={type}
                onClick={() => toggleEdgeFilter(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors',
                  activeEdgeTypes.has(type)
                    ? 'bg-glass-bg text-foreground'
                    : 'text-muted-foreground opacity-50'
                )}
              >
                {type} ({count})
              </button>
            ))}
          </div>

          {/* Graph */}
          <div className="flex-1 relative overflow-hidden">
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={(_, node) => setHoveredNode(node.id)}
              onNodeMouseLeave={() => setHoveredNode(null)}
              onPaneMouseLeave={() => setHoveredNode(null)}
              onPaneMouseMove={() => setHoveredNode(null)}
              onSelectionChange={({ nodes }) => {
                const selected = nodes[0]?.id || null;
                setSelectedNode(selected);
              }}
              onNodeDoubleClick={() => {
                setSelectedNode(null);
              }}
              onPaneClick={() => {
                setSelectedNode(null);
              }}
              connectionMode={ConnectionMode.Loose}
              fitView
              fitViewOptions={{ padding: 0.1, maxZoom: 1.2, minZoom: 0.5 }}
              nodeTypes={{
                custom: (props) => <CustomNode {...props} selected={props.id === selectedNode} />,
              }}
              defaultEdgeOptions={{
                style: { strokeWidth: 2.5 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 25,
                  height: 25,
                },
              }}
              edgesUpdatable={false}
              nodesDraggable={true}
              nodesConnectable={false}
            >
              <Controls className="!bg-glass-bg !border-glass-border !rounded-lg" />
              <div className="pointer-events-none absolute bottom-0 right-0 z-20">
                <MiniMap 
                  className="!bg-transparent !border-glass-border !rounded-none !w-64 !h-64 !p-0 !m-0"
                  nodeColor={(node) => nodeColors[node.data?.nodeType] || '#e5e7eb'}
                  nodeStrokeColor={(node) => nodeColors[node.data?.nodeType] || '#f9fafb'}
                  nodeStrokeWidth={2}
                  nodeRadius={10}
                  maskColor="rgba(255, 255, 255, 0.15)"
                  pannable={false}
                  zoomable={false}
                />
              </div>
              <Background 
                color="#2a2a3e" 
                gap={20}
                size={1}
              />
            </ReactFlow>
          </div>
        </div>
      </div>

      {/* Node Details Panel */}
      <div className="w-80 shrink-0">
        <div className="glass-panel h-full flex flex-col">
          <div className="border-b border-glass-border p-4">
            <h2 className="font-semibold">Node Details</h2>
          </div>
          
          <div className="flex-1 overflow-auto p-4 custom-scrollbar">
            {selectedNodeData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-glass-border">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-lg text-white shadow-lg"
                    style={{ backgroundColor: nodeColors[selectedNodeData.type] || '#4b5563' }}
                  >
                    {nodeIcons[selectedNodeData.type] || <Box className="h-6 w-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base truncate">{selectedNodeData.name}</p>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{selectedNodeData.type}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">File Path</p>
                    <p className="text-sm font-mono">{selectedNodeData.filePath}</p>
                  </div>

                  {selectedNodeData.metadata && (
                    <>
                      {selectedNodeData.metadata.language && (
                        <div>
                          <p className="text-xs text-muted-foreground">Language</p>
                          <p className="text-sm">{selectedNodeData.metadata.language}</p>
                        </div>
                      )}
                      {selectedNodeData.metadata.startLine && (
                        <div>
                          <p className="text-xs text-muted-foreground">Lines</p>
                          <p className="text-sm">
                            {selectedNodeData.metadata.startLine} - {selectedNodeData.metadata.endLine}
                          </p>
                        </div>
                      )}
                      {selectedNodeData.metadata.signature && (
                        <div>
                          <p className="text-xs text-muted-foreground">Signature</p>
                          <p className="text-sm font-mono text-xs">{selectedNodeData.metadata.signature}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Connections</p>
                  <div className="space-y-2">
                    {allFlowEdges
                      .filter((edge) => edge.source === selectedNodeData.id || edge.target === selectedNodeData.id)
                      .map((edge) => {
                        const isOutgoing = edge.source === selectedNodeData.id;
                        const otherId = isOutgoing ? edge.target : edge.source;
                        const otherNode = nodes.find((n) => n.id === otherId);
                        const edgeType = (edge.data as { edgeType?: string })?.edgeType || edge.label?.toString() || 'LINK';
                        const color = edgeColors[edgeType] || '#6b7280';
                        
                        return (
                          <button
                            key={edge.id}
                            onClick={() => {
                              if (otherNode) setSelectedNode(otherId);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg bg-glass-bg p-3 text-left text-sm hover:bg-glass-bg-light transition-colors border border-glass-border hover:border-brand-orange/50 group"
                          >
                            <div 
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={cn(
                                  "text-xs font-semibold uppercase tracking-wide",
                                  isOutgoing ? "text-brand-orange" : "text-muted-foreground"
                                )}>
                                  {isOutgoing ? '→' : '←'} {edgeType}
                                </span>
                              </div>
                              <p className="text-xs font-medium truncate group-hover:text-brand-orange transition-colors">
                                {otherNode?.data.label || otherId.split('/').pop() || otherId}
                              </p>
                              {otherNode && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                  {otherNode.data.nodeType}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    {allFlowEdges.filter((edge) => edge.source === selectedNodeData.id || edge.target === selectedNodeData.id).length === 0 && (
                      <p className="text-xs text-muted-foreground italic">No connections</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <Box className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Click a node to view details
                  </p>
                  {selectedNode && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Selected: {selectedNode}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="border-t border-glass-border p-4">
            <p className="text-xs text-muted-foreground mb-2">Graph Statistics</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded bg-glass-bg p-2 text-center">
                <p className="text-lg font-semibold">{stats.totalNodes}</p>
                <p className="text-xs text-muted-foreground">Nodes</p>
              </div>
              <div className="rounded bg-glass-bg p-2 text-center">
                <p className="text-lg font-semibold">{stats.totalEdges}</p>
                <p className="text-xs text-muted-foreground">Edges</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeGraphPage() {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphContent />
    </ReactFlowProvider>
  );
}

function CustomNode({ data, selected }: { data: { label: string; nodeType: string; filePath?: string }; selected?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white shadow-lg transition-all cursor-pointer",
        selected && "ring-2 ring-brand-orange ring-offset-2 scale-105"
      )}
      style={{ 
        backgroundColor: nodeColors[data.nodeType] || '#4b5563',
        border: selected ? '2px solid #f97316' : 'none',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, width: 6, height: 6, border: 'none' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, width: 6, height: 6, border: 'none' }}
      />
      {nodeIcons[data.nodeType] || <Box className="h-4 w-4" />}
      <span className="font-medium">{data.label}</span>
    </div>
  );
}
