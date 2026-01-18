# Evidence-First Documentation Agent Architecture

## Problem Statement

The documentation agent was over-relying on README files instead of underlying code/configs/datasets/tests, producing documentation that:
- Cited only `README.md` files
- Made claims without code evidence
- Never executed code to validate data-heavy repos (e.g., IFRS9 PD/LGD/ECL datasets)

## Solution: Two-Pass Evidence-First Generation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    PASS 1: Evidence Collection                   │
├─────────────────────────────────────────────────────────────────┤
│  1. Retrieve sources with TIER GATING                           │
│     - Search codebase for relevant chunks                       │
│     - Classify each source: Tier-1 (code) vs Tier-2 (docs)     │
│     - If only Tier-2 found → re-query with Tier-1 specific     │
│                                                                  │
│  2. Run DATA SCHEMA AUDIT (if datasets exist)                   │
│     - Execute Python in sandbox                                  │
│     - Extract: columns, dtypes, null%, min/max, sample rows    │
│     - Store as computed evidence                                 │
│                                                                  │
│  3. Generate NODE SUMMARIES from code (not README)              │
│     - For each relevant KG node: purpose, I/O, dependencies    │
│     - Cache summaries for reuse                                  │
│                                                                  │
│  Output: EvidenceBundle {tier1Sources, tier2Sources,            │
│                          dataEvidence, nodeSummaries}           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PASS 2: Narrative Generation                  │
├─────────────────────────────────────────────────────────────────┤
│  1. Format evidence for LLM with TIER LABELS                    │
│     - Tier-1: "PRIMARY - MUST CITE"                             │
│     - Data Schema: "COMPUTED - HIGH VALUE"                      │
│     - Tier-2: "SUPPLEMENTARY - USE WITH CAUTION"               │
│                                                                  │
│  2. Generate with CLAIM→EVIDENCE rules                          │
│     - Every claim must cite file + line range                   │
│     - Missing evidence → [EVIDENCE GAP: ...]                    │
│     - No speculation, no invented paths                         │
│                                                                  │
│  3. Extract citations and build CLAIM-EVIDENCE MAP              │
│                                                                  │
│  Output: Content + Citations + ClaimEvidenceMap + Gaps          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Quality Metrics & Thresholds                  │
├─────────────────────────────────────────────────────────────────┤
│  Metrics calculated:                                             │
│  - tier1CitationPercent: % of citations from Tier-1             │
│  - tier1SectionCoverage: % of sections with Tier-1 evidence     │
│  - executedValidationsCount: # of data schema audits run        │
│  - uncoveredSectionsCount: sections with NO evidence            │
│  - readmeOnlyCount: sections citing ONLY README/docs            │
│                                                                  │
│  Thresholds (configurable):                                      │
│  - tier1MinPercent: 50% (warning if below)                      │
│  - requireTier1Evidence: true (error if 0 Tier-1)               │
│                                                                  │
│  Violations → Red gaps in UI                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Tiered Source Classification

### Tier 1 (MUST PREFER) - High Trust
| Category | Patterns | Score Boost |
|----------|----------|-------------|
| code | `.py`, `.ts`, `.js`, `.java`, etc. | +150 |
| config | `.yaml`, `.json`, `.toml`, `config.*` | +140 |
| sql | `.sql`, `migrations/` | +145 |
| notebook | `.ipynb` | +135 |
| test | `test_*`, `*_test.*`, `tests/` | +130 |
| dataset | `.csv`, `.parquet`, `datasets/` | +140 |
| pipeline | `airflow`, `dbt`, `workflow` | +135 |

### Tier 2 (LOW TRUST) - Must Corroborate
| Category | Patterns | Score Boost |
|----------|----------|-------------|
| readme | `readme.md` | +25 |
| docs | `docs/`, `.md` | +30 |

## Retrieval Gate Logic

```typescript
// Pseudocode
const results = await search(query);
const tier1 = results.filter(r => classifySource(r.path).tier === 1);
const tier2 = results.filter(r => classifySource(r.path).tier === 2);

if (tier1.length === 0 && config.requireTier1Evidence) {
  // GATE TRIGGERED: Re-query with Tier-1 specific queries
  const tier1Queries = generateTier1Queries(topic);
  for (query of tier1Queries) {
    const moreResults = await search(query);
    tier1.push(...moreResults.filter(isTier1));
  }
}
```

## Data Schema Execution

For repos with `datasets/` or data files:

```python
# Executed in sandbox (containerized, no network, resource limits)
import pandas as pd
df = pd.read_csv(data_file)

schema = {
    "rowCount": len(df),
    "columns": [{
        "name": col,
        "dtype": str(df[col].dtype),
        "nullPercent": df[col].isnull().sum() / len(df) * 100,
        "min": df[col].min() if numeric else None,
        "max": df[col].max() if numeric else None,
        "sampleValues": df[col].head(3).tolist()
    } for col in df.columns]
}
```

This computed schema becomes **primary evidence** for data requirements sections.

## Prompt Engineering Changes

### System Prompt Additions
```
## EVIDENCE HIERARCHY
- TIER-1 (MUST USE): Core code, configs, SQL, tests, notebooks, dataset schemas
- TIER-2 (LOW TRUST): README, docs - use ONLY if corroborated by Tier-1

## CITATION REQUIREMENTS
- Every non-trivial claim MUST cite: [filename.ext:start-end]
- No Tier-1 evidence? Mark: [EVIDENCE GAP: description]

## DATA EVIDENCE
- If dataset schema evidence provided, use as PRIMARY source
- Include actual column names, types, null% from computed schema
```

## Quality Metrics Thresholds

| Metric | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| tier1CitationPercent | < 50% | warning | Yellow gap |
| tier1CitationPercent | < 25% | error | Red gap |
| tier1Citations | = 0 | error | Red gap: "No Tier-1 evidence" |
| readmeOnlyCount | > 2 | warning | Yellow gap |
| uncoveredSectionsCount | > 0 | warning | Yellow gap per section |

## Files Changed

| File | Purpose |
|------|---------|
| `evidence-first.ts` | Tiered source classification, scoring, data execution, metrics |
| `evidence-agent.ts` | Two-pass generation agent, claim-evidence mapping |
| `openai.ts` | Integration: enables evidence-first mode, returns metrics |

## Test Plan

1. **README-Only Prevention Test**
   - Input: Repo with only README.md and code files
   - Expected: Tier-1 code files cited, not just README
   - Check: `tier1CitationPercent > 50%`

2. **Data Schema Audit Test**
   - Input: Repo with `datasets/*.csv`
   - Expected: Schema audit runs, columns/types extracted
   - Check: `executedValidationsCount > 0`

3. **Retrieval Gate Test**
   - Input: Query that initially returns only README
   - Expected: Re-query triggers, Tier-1 sources found
   - Check: `tier1Sources.length > 0` after gate

4. **Gap Detection Test**
   - Input: Section with claims but no code evidence
   - Expected: `[EVIDENCE GAP: ...]` markers in output
   - Check: `gaps.length > 0` with severity 'high'

5. **Quality Threshold Test**
   - Input: Generation with < 25% Tier-1 citations
   - Expected: Error-level violation in `thresholdViolations`
   - Check: Red gap appears in UI

## Usage

Evidence-first mode is **automatically enabled** when:
1. The repository contains data files (`.csv`, `.parquet`, etc.)
2. OR `context.useEvidenceFirst = true` is explicitly set

To configure thresholds:
```typescript
context.evidenceConfig = {
  requireTier1Evidence: true,
  tier1MinPercent: 60,        // Require 60% Tier-1 citations
  runDataSchemaAudit: true,   // Auto-run schema audit
  maxRetries: 2,              // Retrieval gate retries
  dataFileSizeLimit: 10 * 1024 * 1024,  // 10MB max for audit
};
```

