# GenAIOps Performance Optimization Plan

## Executive Summary

**Current Performance**: Your DocGen system is generating documentation sequentially, which causes significant latency. Based on code analysis, a typical document with 5 sections containing 3 blocks each (15 total blocks) takes **~5-10 minutes** to complete.

**Problem**:
- User sees loading dialog for entire duration
- No real-time feedback on completed sections
- Sequential processing bottleneck
- No parallelization of independent blocks

**Solution**: Multi-phase optimization plan that can reduce latency by **60-80%** without compromising accuracy.

---

## Phase 1: Real-Time Section Streaming (CRITICAL - UX Fix)

### Current Behavior
```typescript
// In projects/[id]/page.tsx (lines 191-255)
const result = await generateDocument(context, onProgress);

// Only after ALL sections complete:
updateRun(runId, {
  sections: result.sections, // All sections at once
  status: 'COMPLETED',
});

// Then navigate
router.push(`/projects/${projectId}/runs/${runId}`);
```

**Problem**: User stuck in loading dialog until 100% complete.

### Solution: Stream Sections as They Complete

**Implementation Steps**:

1. **Modify `generateDocument` in [openai.ts:2204-2497](apps/web/src/lib/openai.ts#L2204-L2497)**:

```typescript
export async function generateDocument(
  context: GenerationContext,
  onProgress?: (progress: number, message: string) => void,
  onSectionComplete?: (section: GeneratedSection) => void, // NEW callback
  projectCache?: { /* ... */ }
): Promise<GenerationResult> {
  // ... existing setup code ...

  const sections: GeneratedSection[] = [];
  for (const templateSection of context.template.sections) {
    const section = await processSection(
      openai,
      context,
      templateSection,
      [],
      (message) => {
        completedBlocks++;
        const progress = 15 + (completedBlocks / totalBlocks) * 70;
        onProgress?.(progress, message);
      }
    );
    sections.push(section);

    // NEW: Stream section immediately after completion
    onSectionComplete?.(section);
  }

  // ... rest of function ...
}
```

2. **Update generation flow in [projects/[id]/page.tsx:191-255](apps/web/src/app/(dashboard)/projects/[id]/page.tsx#L191-L255)**:

```typescript
// Navigate to document page immediately BEFORE generation starts
router.push(`/projects/${projectId}/runs/${runId}`);

// Then start generation with section streaming
const generationPromise = generateDocument(
  context,
  (progress, message) => {
    setGenerationProgress(progress);
    setGenerationMessage(message);
    updateRun(runId, { progress: Math.round(progress) });
  },
  (section) => {
    // NEW: Update run with partial results as sections complete
    const currentRun = useProjectsStore.getState().projects
      .find(p => p.id === projectId)?.runs
      .find(r => r.id === runId);

    const updatedSections = [...(currentRun?.sections || []), section];

    updateRun(runId, {
      sections: updatedSections,
      progress: Math.round(15 + (updatedSections.length / template.sections.length) * 70),
    });

    console.log(`[UI] Section "${section.title}" streamed to UI`);
  },
  projectCache
);
```

3. **Add polling to runs page** (optional, for robustness):

```typescript
// In runs/[runId]/page.tsx, add polling while status is IN_PROGRESS
useEffect(() => {
  if (run?.status === 'IN_PROGRESS') {
    const pollInterval = setInterval(() => {
      // Force re-render by accessing store
      const updatedRun = useProjectsStore.getState().projects
        .find(p => p.id === projectId)?.runs
        .find(r => r.id === runId);

      if (updatedRun && updatedRun !== run) {
        console.log('[UI] Detected run update via polling');
      }
    }, 1000); // Poll every 1 second

    return () => clearInterval(pollInterval);
  }
}, [run?.status, runId, projectId]);
```

**Impact**:
- ✅ User sees sections appear in real-time (1-2 minute intervals)
- ✅ Perceived latency reduced by **60%**
- ✅ User can start reading early sections while later ones generate
- ✅ No changes to accuracy or quality

**Effort**: ~2-3 hours

---

## Phase 2: Parallel Block Generation (HIGH IMPACT - Latency Reduction)

### Current Bottleneck

```typescript
// In openai.ts, line 1711-1729
for (let i = 0; i < section.blocks.length; i++) {
  const block = section.blocks[i];
  const generatedBlock = await generateBlock(openai, context, block);
  blocks.push(generatedBlock);
}
```

**Problem**: Blocks in the same section are generated sequentially, even when they're independent.

### Current Timing Analysis

**Per Block Type** (based on code inspection):
- Text block: ~15-30s (1-3 LLM calls with evidence retrieval)
- Chart block: ~30-60s (5-8 LLM calls in ReAct loop + Python execution)
- Table block: ~20-40s (similar to chart blocks)

**Example Document** (5 sections, 3 blocks each):
```
Section 1: [Text, Text, Chart] = 15s + 15s + 45s = 75s
Section 2: [Text, Chart, Chart] = 15s + 45s + 45s = 105s
Section 3: [Text, Text, Table] = 15s + 15s + 30s = 60s
Section 4: [Text, Chart, Text] = 15s + 45s + 15s = 75s
Section 5: [Text, Text, Text] = 15s + 15s + 15s = 45s

Total: 360 seconds = 6 minutes (sequential)
```

### Solution: Parallel Block Generation

**Strategy**: Generate independent blocks in parallel while maintaining evidence context.

**Implementation**:

```typescript
// In openai.ts, modify processSection function
async function processSection(
  openai: OpenAI,
  context: GenerationContext,
  section: TemplateSection,
  parentPath: string[],
  onProgress: (message: string) => void
): Promise<GeneratedSection> {
  const currentPath = [...parentPath, section.title];

  console.log(`[OpenAI] Processing section "${section.title}" with ${section.blocks.length} blocks`);

  // NEW: Determine if blocks can be parallelized
  // Blocks can run in parallel if they don't depend on each other
  const canParallelize = section.blocks.every(block => {
    // Chart blocks don't depend on other blocks
    // Text blocks don't depend on other blocks
    // Only sequential if blocks explicitly reference each other
    return true; // For now, parallelize all blocks in a section
  });

  let blocks: GeneratedBlock[];

  if (canParallelize && section.blocks.length > 1) {
    console.log(`[OpenAI] Generating ${section.blocks.length} blocks IN PARALLEL for "${section.title}"`);

    // Generate all blocks in parallel
    const blockPromises = section.blocks.map(async (block, i) => {
      console.log(`[OpenAI] Starting parallel block ${i + 1}/${section.blocks.length}: "${block.title}"`);
      onProgress(`Generating: ${section.title} → ${block.title} (parallel)`);

      return await generateBlock(openai, context, {
        id: block.id,
        title: block.title,
        type: block.type,
        instructions: block.instructions,
        dataSources: block.dataSources || [],
        sectionPath: currentPath,
      });
    });

    // Wait for all blocks to complete
    blocks = await Promise.all(blockPromises);

    console.log(`[OpenAI] All ${blocks.length} blocks for "${section.title}" completed in parallel`);
  } else {
    // Sequential generation (existing code)
    blocks = [];
    for (let i = 0; i < section.blocks.length; i++) {
      const block = section.blocks[i];
      console.log(`[OpenAI] Generating block ${i + 1}/${section.blocks.length}: "${block.title}" (sequential)`);

      onProgress(`Generating: ${section.title} → ${block.title} (${block.type})`);

      const generatedBlock = await generateBlock(openai, context, {
        id: block.id,
        title: block.title,
        type: block.type,
        instructions: block.instructions,
        dataSources: block.dataSources || [],
        sectionPath: currentPath,
      });

      blocks.push(generatedBlock);
    }
  }

  // ... rest of function unchanged ...
}
```

**Impact with Parallelization**:

```
Section 1: [Text, Text, Chart] = max(15s, 15s, 45s) = 45s (was 75s) ✅ 40% faster
Section 2: [Text, Chart, Chart] = max(15s, 45s, 45s) = 45s (was 105s) ✅ 57% faster
Section 3: [Text, Text, Table] = max(15s, 15s, 30s) = 30s (was 60s) ✅ 50% faster
Section 4: [Text, Chart, Text] = max(15s, 45s, 15s) = 45s (was 75s) ✅ 40% faster
Section 5: [Text, Text, Text] = max(15s, 15s, 15s) = 15s (was 45s) ✅ 67% faster

Total: 180 seconds = 3 minutes (was 6 minutes) ✅ 50% FASTER
```

**Caveats**:
- Rate limits: OpenAI allows 3,500 RPM on gpt-4o-mini tier 1 (sufficient for parallel blocks)
- Memory: Evidence context is shared, no duplication
- Order: Blocks still appear in original order in final document

**Effort**: ~4-6 hours

---

## Phase 3: Model Selection Optimization (MEDIUM IMPACT)

### Current Model Usage

All blocks use `gpt-4o-mini` with identical settings:

```typescript
// In openai.ts, line 1464
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini', // Always mini, regardless of complexity
  temperature: 0.5,
  max_tokens: 2000,
  // ...
});
```

### Problem Analysis

**gpt-4o-mini** (current):
- Latency: ~2-5s per call
- Quality: Good for structured tasks
- Cost: $0.15/1M input tokens, $0.60/1M output tokens

**gpt-4o** (available):
- Latency: ~3-8s per call (1.5x slower)
- Quality: Better reasoning, but overkill for many blocks
- Cost: $2.50/1M input tokens, $10/1M output tokens (16x more expensive)

**gpt-4o-mini** is already optimal for most blocks!

### Optimization Strategy

**Use FASTER models for simple blocks**:

```typescript
function selectModelForBlock(block: TemplateBlock, blockType: string): string {
  // Chart blocks need reasoning - use mini
  if (blockType === 'LLM_CHART') return 'gpt-4o-mini';

  // Simple text blocks with < 50 words instructions - use mini (already fast)
  if (blockType === 'LLM_TEXT' && block.instructions.split(' ').length < 50) {
    return 'gpt-4o-mini';
  }

  // Complex analysis blocks - consider gpt-4o for quality
  if (block.instructions.toLowerCase().includes('analyze') ||
      block.instructions.toLowerCase().includes('compare') ||
      block.instructions.toLowerCase().includes('evaluate')) {
    return 'gpt-4o-mini'; // Still use mini - quality is sufficient
  }

  return 'gpt-4o-mini'; // Default
}
```

**Recommendation**: **Keep using gpt-4o-mini for everything.** It's already the fastest model with good quality.

**Impact**: Minimal - current model selection is already optimal.

**Effort**: 1 hour (optional quality upgrade for specific blocks)

---

## Phase 4: Evidence Retrieval Optimization (MEDIUM IMPACT)

### Current Evidence Retrieval

In [evidence-first.ts](apps/web/src/lib/evidence-first.ts):

```typescript
// Tier-1 retrieval: Semantic search (embedding-based)
const tier1Results = await semanticSearch(
  query,
  codeIntelligence,
  config.tier1Limit // Default: 5 sources
);

// Tier-2 retrieval: Graph traversal
const tier2Results = await getTier2SourcesFromGraph(
  tier1Results.map(r => r.chunk.filePath),
  codeIntelligence,
  config.tier2Limit // Default: 10 sources
);
```

**Timing**:
- Semantic search: ~200-500ms (embedding similarity)
- Graph traversal: ~100-300ms
- **Total per block: ~300-800ms**

### Optimization Strategies

**1. Pre-compute Evidence at Document Level** (Already Partially Done!)

From line 2334-2354, schema audits are already run once at document level. Extend this to evidence:

```typescript
// In generateDocument, after schema audits
onProgress?.(50, 'Pre-computing evidence for all sections...');

const sectionEvidenceCache = new Map<string, EvidenceBundle>();

// Pre-compute evidence for each section based on its title + block instructions
for (const templateSection of context.template.sections) {
  const sectionQuery = `${templateSection.title}: ${templateSection.blocks.map(b => b.instructions).join(' ')}`;

  // Run semantic search once per section
  const evidenceBundle = await collectEvidenceWithSearch(
    openai,
    sectionQuery,
    context.codeIntelligence!,
    context.evidenceConfig || DEFAULT_EVIDENCE_CONFIG,
    context.codebase?.files.filter((f: { path: string }) => {
      const { category } = classifySource(f.path);
      return category === 'dataset';
    }).map((f: { path: string }) => ({ path: f.path, repoUrl: context.repoUrl })) || [],
    globalDataEvidence
  );

  sectionEvidenceCache.set(templateSection.title, evidenceBundle);
  console.log(`[DocGen] Pre-computed evidence for "${templateSection.title}": ${evidenceBundle.tier1Sources.length} Tier-1, ${evidenceBundle.tier2Sources.length} Tier-2`);
}

// Store in context
context.sectionEvidenceCache = sectionEvidenceCache;
```

Then in `generateSectionWithEvidence`:

```typescript
// Check cache first
let evidenceBundle: EvidenceBundle;

if (ctx.sectionEvidenceCache?.has(sectionTitle)) {
  evidenceBundle = ctx.sectionEvidenceCache.get(sectionTitle)!;
  console.log(`[EvidenceAgent] Using pre-computed evidence for "${sectionTitle}"`);
} else {
  // Fall back to per-block retrieval
  evidenceBundle = await collectEvidenceWithSearch(/* ... */);
}
```

**Impact**:
- ✅ Eliminates 300-800ms per block
- ✅ For 15 blocks: saves **4.5-12 seconds**
- ✅ Enables better parallelization (evidence ready upfront)

**Effort**: ~3-4 hours

**2. Increase Tier-1 Limit for Better Recall**

Current default: 5 Tier-1 sources. Consider increasing to 7-10 for complex sections:

```typescript
// In evidence-first.ts, modify DEFAULT_CONFIG
export const DEFAULT_CONFIG: EvidenceFirstConfig = {
  tier1Limit: 8, // Increased from 5
  tier2Limit: 12, // Increased from 10
  // ...
};
```

**Impact**:
- ✅ Better evidence quality
- ❌ Slightly more tokens (~500-1000 per block)
- ❌ Slightly more latency (~100-200ms per block)

**Trade-off**: Quality vs speed. Recommend keeping at 5 for speed.

---

## Phase 5: LLM Iteration Reduction (LOW IMPACT - Already Optimized!)

### Current Iteration Limits

From [evidence-agent.ts:781](apps/web/src/lib/evidence-agent.ts#L781):

```typescript
const maxIterations = ctx.blockType === 'LLM_CHART' ? 5 : 3;
```

**Analysis**: These limits are already optimal!

- Chart blocks: 5 iterations → typically use 2-3 (early termination working)
- Text blocks: 3 iterations → typically use 1-2

**From logs** (based on CHANGES_SUMMARY.md):
- Early termination prevents wasted iterations
- Duplicate table generation fixed
- Charts complete after 2-3 iterations on average

**Recommendation**: **No changes needed** - already optimized.

---

## Phase 6: Streaming LLM Responses (LOW-MEDIUM IMPACT)

### Current Implementation

```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [/* ... */],
  stream: false, // No streaming!
});
```

### Streaming Benefits

**With streaming**:
- First token appears in ~500-800ms
- User sees content building up in real-time
- Reduces perceived latency by **40-50%**

**Implementation**:

```typescript
const stream = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [/* ... */],
  stream: true, // Enable streaming
});

let content = '';
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content || '';
  content += delta;

  // Send delta to UI in real-time
  onContentDelta?.(delta);
}
```

**Impact**:
- ✅ User sees text appear immediately (500ms vs 5s wait)
- ✅ Perceived latency -40%
- ❌ Requires WebSocket or SSE for UI updates
- ❌ More complex error handling

**Effort**: ~6-8 hours (significant refactoring)

**Recommendation**: **Implement in Phase 7** (after parallelization shows results)

---

## Implementation Roadmap

### Week 1: Critical UX Fixes
**Goal**: User sees real-time section updates

- ✅ Phase 1: Real-Time Section Streaming (2-3 hours)
  - Modify `generateDocument` to call `onSectionComplete`
  - Update generation flow to navigate early + stream sections
  - Add polling to runs page (optional)

**Expected Impact**: 60% reduction in perceived latency

---

### Week 2: Performance Optimization
**Goal**: Reduce actual generation time by 50%

- ✅ Phase 2: Parallel Block Generation (4-6 hours)
  - Modify `processSection` to use `Promise.all`
  - Test with rate limits (should be fine with mini)
  - Monitor quality (should be unchanged)

**Expected Impact**: 50% reduction in actual latency (6min → 3min)

---

### Week 3: Evidence & Caching
**Goal**: Eliminate redundant evidence retrieval

- ✅ Phase 4: Pre-compute Section Evidence (3-4 hours)
  - Cache evidence at document level
  - Reuse across blocks in same section
  - Log cache hits for monitoring

**Expected Impact**: Additional 5-10% latency reduction

---

### Week 4: Advanced Features (Optional)
**Goal**: Streaming content for real-time feedback

- 🔄 Phase 6: Streaming LLM Responses (6-8 hours)
  - Refactor to support streaming
  - Add WebSocket/SSE for UI
  - Handle partial content rendering

**Expected Impact**: 40% reduction in perceived latency on top of other improvements

---

## Combined Impact Projection

### Current State
- **Total time**: 6 minutes for 15-block document
- **Perceived wait**: 6 minutes (stuck in loading dialog)
- **User experience**: Poor (no feedback until complete)

### After Phase 1 (Real-Time Streaming)
- **Total time**: 6 minutes (unchanged)
- **Perceived wait**: 1-2 minutes (see first section immediately)
- **User experience**: Good (can start reading early)

### After Phase 1 + 2 (Streaming + Parallelization)
- **Total time**: 3 minutes (-50%)
- **Perceived wait**: 30-60 seconds
- **User experience**: Excellent

### After All Phases (1 + 2 + 4 + 6)
- **Total time**: 2.5 minutes (-58%)
- **Perceived wait**: 10-15 seconds (streaming text appears immediately)
- **User experience**: Outstanding

---

## Monitoring & Metrics

### Add Performance Tracking

```typescript
// In openai.ts, add timing logs
const blockStartTime = Date.now();
const generatedBlock = await generateBlock(/* ... */);
const blockDuration = Date.now() - blockStartTime;

console.log(`[Performance] Block "${block.title}" (${block.type}): ${blockDuration}ms`);

// Store in metrics
if (!context.performanceMetrics) {
  context.performanceMetrics = { blocks: [] };
}
context.performanceMetrics.blocks.push({
  title: block.title,
  type: block.type,
  duration: blockDuration,
  llmCalls: /* track this */,
});
```

### Expose in UI

Show generation statistics after completion:

```
Document Generation Complete!
Total time: 3m 24s
- Section 1: 45s (3 blocks in parallel)
- Section 2: 38s (3 blocks in parallel)
- Section 3: 52s (3 blocks in parallel)
...
```

---

## Risk Assessment

### Low Risk Changes
- ✅ Phase 1 (Real-time streaming) - No accuracy impact, pure UX improvement
- ✅ Phase 4 (Evidence caching) - Same evidence, just retrieved once

### Medium Risk Changes
- ⚠️ Phase 2 (Parallelization) - Test thoroughly for quality impact
  - **Mitigation**: Compare 10 documents sequential vs parallel
  - **Expected**: No quality difference (blocks are independent)

### High Risk Changes
- ⚠️ Phase 6 (Streaming responses) - Complex refactoring
  - **Mitigation**: Implement behind feature flag
  - **Rollback**: Easy to disable streaming

---

## Cost Analysis

### Current Costs (per document)

**Example Document** (15 blocks):
- Evidence retrieval: 15 × 2 LLM calls × 1500 tokens = 45k tokens
- Block generation: 15 × 3 LLM calls × 2000 tokens = 90k tokens
- **Total: ~135k tokens**

**Cost**: ~$0.02 per document with gpt-4o-mini

### After Optimizations

**Evidence caching** (Phase 4):
- Evidence retrieval: 5 sections × 2 LLM calls × 1500 tokens = 15k tokens (was 45k)
- Block generation: 15 × 3 LLM calls × 2000 tokens = 90k tokens (unchanged)
- **Total: ~105k tokens**

**Cost**: ~$0.015 per document ✅ **25% cost reduction**

**Parallelization** (Phase 2): No cost impact (same LLM calls, just concurrent)

---

## Recommendations

### Immediate Actions (This Week)
1. ✅ **Implement Phase 1** (Real-time section streaming) - 2-3 hours
   - Biggest UX improvement
   - Zero risk
   - Immediate user satisfaction

2. ✅ **Implement Phase 2** (Parallel block generation) - 4-6 hours
   - Biggest performance improvement (-50% latency)
   - Low risk (blocks are independent)
   - Test thoroughly

### Next Month
3. ✅ **Implement Phase 4** (Evidence pre-computation) - 3-4 hours
   - Additional 5-10% latency reduction
   - 25% cost reduction
   - Enables better parallelization

### Future (Optional)
4. 🔄 **Implement Phase 6** (Streaming) - 6-8 hours
   - Advanced UX feature
   - Requires infrastructure (WebSocket/SSE)
   - Consider after measuring Phase 1+2 impact

---

## Testing Plan

### Phase 1 Testing
1. Generate a test document with 3 sections
2. Verify sections appear in UI as they complete (every 1-2 minutes)
3. Check that navigation happens before generation starts
4. Confirm no data loss or corruption

### Phase 2 Testing
1. Generate 5 identical documents:
   - 3 with parallel generation
   - 2 with sequential generation (control)
2. Compare:
   - Total generation time (expect 40-50% reduction)
   - Content quality (expect identical)
   - Evidence citations (expect identical)
3. Monitor OpenAI rate limits (should be fine with mini)

### Phase 4 Testing
1. Check console logs for evidence cache hits
2. Verify cache contains correct evidence for each section
3. Compare evidence quality with/without caching (expect identical)
4. Measure latency reduction (expect 5-10%)

---

## Conclusion

Your DocGen system can be optimized from **6 minutes → 2.5 minutes** (-58% actual latency) and **perceived latency from 6 minutes → 10-15 seconds** (-97% perceived latency) with a structured 4-week implementation plan.

**Start with Phase 1 + 2** (real-time streaming + parallelization) for maximum impact with minimal risk.

**Total effort**: ~10-15 hours for 70-80% of the benefit.

---

**Questions?** Check implementation details in each phase section above.
