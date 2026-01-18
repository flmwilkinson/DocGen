# GenAI Architecture Optimization Plan

## Current Architecture Analysis

### ✅ What's Working Well
1. **Code Intelligence Caching**: KG and embeddings cached in IndexedDB
2. **Single Parse**: Files parsed once during code intelligence build
3. **Knowledge Graph Usage**: Relationships used for related chunks
4. **Evidence-First Agent**: Proper two-pass architecture

### ❌ Inefficiencies Found

#### 1. **Duplicate Semantic Searches**
- **Issue**: `generateBlock()` legacy path does semantic search, but evidence agent also searches
- **Impact**: Redundant embedding queries, wasted tokens
- **Fix**: Remove semantic search from legacy path when evidence-first is enabled

#### 2. **Per-Section Data File Processing**
- **Issue**: Data files filtered and schema audits run per section
- **Impact**: Same files processed multiple times, redundant sandbox calls
- **Fix**: Process once globally, cache results

#### 3. **Per-Section Node Summary Generation**
- **Issue**: Node summaries generated individually per section
- **Impact**: Multiple LLM calls for same files
- **Fix**: Batch generate summaries upfront, reuse cache

#### 4. **No Search Query Memoization**
- **Issue**: Same queries might run multiple times
- **Impact**: Redundant embedding generation
- **Fix**: Cache search results by query hash

#### 5. **Inefficient Knowledge Graph Traversal**
- **Issue**: Related chunks computed on-the-fly per search
- **Impact**: O(n²) complexity for relationship lookups
- **Fix**: Pre-compute adjacency lists

#### 6. **File Transfer Redundancy**
- **Issue**: Same files transferred to sandbox per chart generation
- **Impact**: Network overhead, slower execution
- **Fix**: Transfer once, reuse execution directory

## Optimization Implementation

### Phase 1: Eliminate Redundancies (High Impact, Low Risk)
1. Remove duplicate semantic search in legacy path
2. Global data file processing
3. Batch node summary generation

### Phase 2: Caching & Memoization (Medium Impact, Low Risk)
1. Memoize search queries
2. Cache schema audit results
3. Pre-compute KG adjacency lists

### Phase 3: Streaming & Batching (High Impact, Medium Risk)
1. Stream embedding generation
2. Batch LLM calls where possible
3. Parallelize independent operations

## Expected Performance Gains

- **Latency Reduction**: 30-50% faster document generation
- **Token Savings**: 20-30% fewer LLM calls
- **Network Efficiency**: 40-60% fewer sandbox transfers
- **Memory**: Better cache hit rates

