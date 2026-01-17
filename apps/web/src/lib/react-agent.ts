/**
 * ReAct Agent for Documentation Generation
 * 
 * Implements the ReAct (Reasoning + Acting) pattern:
 * 1. THINK - Reason about what information is needed
 * 2. ACT - Search the codebase for relevant code
 * 3. OBSERVE - Analyze search results
 * 4. DRAFT - Write content based on observations
 * 5. VERIFY - Check output against actual code
 * 6. REFINE - If verification fails, loop back
 * 
 * This prevents hallucination by grounding every claim in actual code.
 */

import OpenAI from 'openai';
import { CodeIntelligenceResult, CodeChunk, semanticSearch } from './code-intelligence';

// =============================================================================
// TYPES
// =============================================================================

export interface AgentMemory {
  codebaseUnderstanding: string;           // Accumulated understanding of the codebase
  filesSeen: Map<string, string>;          // Files we've actually looked at
  confirmedFacts: string[];                // Facts verified against code
  sectionsGenerated: string[];             // Sections we've already written
}

export interface AgentContext {
  openai: OpenAI;
  codeIntelligence: CodeIntelligenceResult;
  memory: AgentMemory;
  projectName: string;
  availableFiles: string[];                // List of files that actually exist
}

export interface ThinkResult {
  needsSearch: boolean;
  searchQueries: string[];
  reasoning: string;
}

export interface SearchResult {
  query: string;
  chunks: CodeChunk[];
  summary: string;
}

export interface DraftResult {
  content: string;
  citations: string[];
  confidence: number;
}

export interface VerifyResult {
  isValid: boolean;
  issues: string[];
  invalidCitations: string[];
}

export interface AgentResult {
  content: string;
  citations: string[];
  confidence: number;
  searchIterations: number;
  verificationPassed: boolean;
}

// =============================================================================
// AGENT TOOLS
// =============================================================================

/**
 * THINK: Reason about what information is needed for this section
 */
async function think(
  ctx: AgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  previousAttempt?: string
): Promise<ThinkResult> {
  const memoryContext = ctx.memory.codebaseUnderstanding 
    ? `\n\nWhat I know about this codebase:\n${ctx.memory.codebaseUnderstanding}`
    : '';
  
  const previousContext = previousAttempt 
    ? `\n\nMy previous attempt had issues. I need to search for more specific information.`
    : '';

  const response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a documentation agent analyzing a codebase. Your job is to THINK about what code you need to find to write a documentation section.

Available files in this codebase: ${ctx.availableFiles.slice(0, 30).join(', ')}
${memoryContext}
${previousContext}

Respond with JSON:
{
  "reasoning": "Your thought process about what information is needed",
  "needsSearch": true/false,
  "searchQueries": ["specific search query 1", "specific search query 2"]
}

Be SPECIFIC in your search queries. Don't search for generic concepts - search for what would actually be in this codebase.`
      },
      {
        role: 'user',
        content: `I need to write the "${sectionTitle}" section.

Instructions: ${sectionInstructions}

What specific code should I search for?`
      }
    ],
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: 'json_object' }
  });

  try {
    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    return {
      reasoning: result.reasoning || '',
      needsSearch: result.needsSearch !== false,
      searchQueries: result.searchQueries || [sectionTitle]
    };
  } catch {
    return {
      reasoning: 'Failed to reason, will search for section title',
      needsSearch: true,
      searchQueries: [sectionTitle]
    };
  }
}

/**
 * ACT: Search the codebase for relevant code
 */
async function search(
  ctx: AgentContext,
  queries: string[]
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  for (const query of queries.slice(0, 3)) { // Limit searches
    try {
      const chunks = await semanticSearch(
        query, 
        ctx.codeIntelligence.chunks, 
        ctx.openai, 
        5
      );
      
      // Store in memory
      for (const chunk of chunks) {
        ctx.memory.filesSeen.set(chunk.chunk.filePath, chunk.chunk.content.slice(0, 500));
      }
      
      const summary = chunks.length > 0
        ? `Found ${chunks.length} relevant code sections for "${query}": ${chunks.map(c => c.chunk.filePath).join(', ')}`
        : `No relevant code found for "${query}"`;
      
      results.push({
        query,
        chunks: chunks.map(c => c.chunk),
        summary
      });
    } catch (error) {
      console.error(`[Agent] Search failed for query "${query}":`, error);
    }
  }
  
  return results;
}

/**
 * OBSERVE: Build context from search results
 */
function observe(searchResults: SearchResult[]): string {
  if (searchResults.length === 0 || searchResults.every(r => r.chunks.length === 0)) {
    return 'No relevant code was found. I should describe what this codebase ACTUALLY does based on what I know, or state that this section is not applicable.';
  }
  
  let observation = '## Code Found:\n\n';
  
  for (const result of searchResults) {
    for (const chunk of result.chunks) {
      observation += `### ${chunk.filePath} (${chunk.type}: ${chunk.name})\n`;
      if (chunk.docstring) {
        observation += `Documentation: ${chunk.docstring}\n`;
      }
      observation += `\`\`\`${chunk.language}\n${chunk.content.slice(0, 1200)}\n\`\`\`\n\n`;
    }
  }
  
  return observation;
}

/**
 * DRAFT: Write content based on observations
 */
async function draft(
  ctx: AgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  observation: string,
  availableCitations: string[]
): Promise<DraftResult> {
  const response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are writing documentation based on ACTUAL code you've found.

## CRITICAL RULES
1. ONLY describe what you see in the code provided
2. ONLY cite files from this list: ${availableCitations.join(', ')}
3. If you don't see relevant code, say so honestly
4. NO made-up file paths, NO invented code examples
5. If this section doesn't apply to this codebase, explain why and describe what's actually there

## What I know about this codebase:
${ctx.memory.codebaseUnderstanding}

## Previously confirmed facts:
${ctx.memory.confirmedFacts.slice(-5).join('\n') || 'None yet'}`
      },
      {
        role: 'user',
        content: `Write the "${sectionTitle}" section.

Instructions: ${sectionInstructions}

${observation}

---

## CRITICAL: DO NOT include the section title "${sectionTitle}" in your response.
The title will be rendered separately. Start directly with your content.

Based on the code above, write this section. Cite files as [filename.ext].
If the code doesn't contain what's needed for this section, adapt the section to describe what IS there.`
      }
    ],
    temperature: 0.4,
    max_tokens: 1500
  });

  const content = response.choices[0]?.message?.content || '';
  
  // Extract citations
  const citationRegex = /\[([^\]]+\.[a-zA-Z]+(?::\d+-\d+)?)\]/g;
  const citations: string[] = [];
  let match;
  while ((match = citationRegex.exec(content)) !== null) {
    citations.push(match[1].split(':')[0]); // Remove line numbers
  }
  
  return {
    content,
    citations: [...new Set(citations)],
    confidence: 0.8
  };
}

/**
 * VERIFY: Check that all citations are valid
 */
function verify(
  ctx: AgentContext,
  draftResult: DraftResult
): VerifyResult {
  const issues: string[] = [];
  const invalidCitations: string[] = [];
  
  // Check each citation against available files
  for (const citation of draftResult.citations) {
    const isValid = ctx.availableFiles.some(f => 
      f.includes(citation) || citation.includes(f.split('/').pop() || '')
    );
    
    if (!isValid) {
      invalidCitations.push(citation);
      issues.push(`Citation [${citation}] does not exist in codebase`);
    }
  }
  
  // Check for hallucination patterns
  const hallucinationPatterns = [
    { pattern: /num_layers.*:\s*\d+/i, issue: 'Made-up layer configuration' },
    { pattern: /hidden_size.*:\s*\d+/i, issue: 'Made-up hidden size' },
    { pattern: /model_config\s*=\s*\{/i, issue: 'Made-up model config' },
    { pattern: /\bnn\.Module\b/i, issue: 'PyTorch code when not a PyTorch project' },
    { pattern: /\btf\.keras\b/i, issue: 'TensorFlow code when not a TensorFlow project' },
  ];
  
  // Only flag if we didn't actually find these in code
  for (const { pattern, issue } of hallucinationPatterns) {
    if (pattern.test(draftResult.content)) {
      // Check if this pattern exists in any file we've seen
      const existsInCode = Array.from(ctx.memory.filesSeen.values()).some(
        content => pattern.test(content)
      );
      if (!existsInCode) {
        issues.push(issue);
      }
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    invalidCitations
  };
}

/**
 * REFINE: Clean up content by removing invalid citations
 */
function refine(content: string, invalidCitations: string[]): string {
  let refined = content;
  
  for (const citation of invalidCitations) {
    const escaped = citation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    refined = refined.replace(new RegExp(`\\[${escaped}\\]`, 'g'), '');
  }
  
  return refined;
}

// =============================================================================
// MAIN AGENT LOOP
// =============================================================================

/**
 * Run the ReAct agent to generate a documentation section
 */
export async function generateWithAgent(
  ctx: AgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  maxIterations: number = 3
): Promise<AgentResult> {
  console.log(`[Agent] Starting generation for: ${sectionTitle}`);
  
  let iterations = 0;
  let bestDraft: DraftResult | null = null;
  let lastVerification: VerifyResult | null = null;
  
  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    
    // THINK: What do I need to find?
    console.log(`[Agent] Iteration ${i + 1}: THINKING...`);
    const thinking = await think(
      ctx, 
      sectionTitle, 
      sectionInstructions,
      bestDraft?.content
    );
    console.log(`[Agent] Reasoning: ${thinking.reasoning.slice(0, 100)}...`);
    
    // ACT: Search for relevant code
    console.log(`[Agent] SEARCHING for: ${thinking.searchQueries.join(', ')}`);
    const searchResults = await search(ctx, thinking.searchQueries);
    
    // OBSERVE: Analyze what we found
    const observation = observe(searchResults);
    const availableCitations = searchResults.flatMap(r => r.chunks.map(c => c.filePath));
    console.log(`[Agent] Found ${availableCitations.length} potential citations`);
    
    // DRAFT: Write content
    console.log(`[Agent] DRAFTING content...`);
    const draft = await draft(
      ctx, 
      sectionTitle, 
      sectionInstructions, 
      observation,
      [...new Set([...availableCitations, ...ctx.availableFiles.slice(0, 10)])]
    );
    
    // VERIFY: Check for hallucinations
    console.log(`[Agent] VERIFYING draft...`);
    const verification = verify(ctx, draft);
    
    if (verification.isValid) {
      console.log(`[Agent] Verification PASSED on iteration ${i + 1}`);
      
      // Add confirmed facts to memory
      const confirmedFact = `Section "${sectionTitle}" uses files: ${draft.citations.join(', ')}`;
      ctx.memory.confirmedFacts.push(confirmedFact);
      
      return {
        content: draft.content,
        citations: draft.citations,
        confidence: draft.confidence,
        searchIterations: iterations,
        verificationPassed: true
      };
    }
    
    console.log(`[Agent] Verification FAILED: ${verification.issues.join(', ')}`);
    
    // Store best draft so far
    if (!bestDraft || draft.citations.length > bestDraft.citations.length) {
      bestDraft = draft;
      lastVerification = verification;
    }
    
    // If we have invalid citations, try with more specific searches
    if (verification.invalidCitations.length > 0 && i < maxIterations - 1) {
      console.log(`[Agent] Will retry with more specific searches...`);
      continue;
    }
  }
  
  // If we couldn't pass verification, refine the best draft
  console.log(`[Agent] Max iterations reached, refining best draft...`);
  
  if (bestDraft && lastVerification) {
    const refinedContent = refine(bestDraft.content, lastVerification.invalidCitations);
    
    return {
      content: refinedContent,
      citations: bestDraft.citations.filter(c => !lastVerification!.invalidCitations.includes(c)),
      confidence: bestDraft.confidence * 0.8, // Lower confidence for unverified
      searchIterations: iterations,
      verificationPassed: false
    };
  }
  
  // Fallback: generate a minimal response
  return {
    content: `This section requires information that was not found in the analyzed codebase. The available files are: ${ctx.availableFiles.slice(0, 5).join(', ')}.`,
    citations: ctx.availableFiles.slice(0, 3),
    confidence: 0.5,
    searchIterations: iterations,
    verificationPassed: false
  };
}

/**
 * Initialize agent memory with codebase understanding
 */
export async function initializeAgentMemory(
  openai: OpenAI,
  codeIntelligence: CodeIntelligenceResult,
  availableFiles: string[],
  readme?: string
): Promise<AgentMemory> {
  console.log('[Agent] Initializing memory...');
  
  // Build initial codebase understanding
  const keyChunks = codeIntelligence.chunks.slice(0, 15);
  const chunkSummary = keyChunks.map(c => 
    `- ${c.filePath}: ${c.type} "${c.name}"${c.docstring ? ` - ${c.docstring.slice(0, 100)}` : ''}`
  ).join('\n');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Analyze this codebase and create a factual summary. Be specific about what it IS and what it IS NOT.`
      },
      {
        role: 'user',
        content: `Files: ${availableFiles.slice(0, 25).join(', ')}

Key code components:
${chunkSummary}

${readme ? `README:\n${readme.slice(0, 1500)}` : ''}

---

Create a factual summary:
1. What type of system is this? (Be specific: "Next.js web app", "Python CLI", etc.)
2. What does it actually do?
3. What technologies does it use? (Only list what you see)
4. What does it NOT have? (e.g., "No ML training code", "No neural networks")`
      }
    ],
    temperature: 0.3,
    max_tokens: 800
  });
  
  const understanding = response.choices[0]?.message?.content || '';
  console.log('[Agent] Codebase understanding:', understanding.slice(0, 200) + '...');
  
  return {
    codebaseUnderstanding: understanding,
    filesSeen: new Map(),
    confirmedFacts: [],
    sectionsGenerated: []
  };
}

/**
 * Update memory after generating a section
 */
export function updateAgentMemory(
  memory: AgentMemory,
  sectionTitle: string,
  citations: string[]
): void {
  memory.sectionsGenerated.push(sectionTitle);
  memory.confirmedFacts.push(
    `Section "${sectionTitle}" references: ${citations.join(', ') || 'no specific files'}`
  );
}

