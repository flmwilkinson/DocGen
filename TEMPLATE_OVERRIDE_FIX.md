# Template Override Fix - Making DocGen Generic

## Problem

The DocGen system was generating domain-specific (banking) content even when templates requested generic output. Issues included:

1. **Broken image symbols** appearing in output (LLM generating image markdown)
2. **Banking-specific content** (IFRS 9, ECL, PD models) appearing even with generic templates
3. **Verbose narratives** being added when template only requested charts
4. **System prompts overriding template instructions**

### Example
**Template requested:**
- "Write an introduction for this document"
- "Plot graphs showing EDA"

**System generated:**
- Banking-specific introduction mentioning IFRS 9, ECL models
- Charts with verbose descriptions ("Chart 1: Outstanding Amount Distribution...")
- Data Schema Evidence tables (not requested)
- Broken image markdown symbols

## Root Causes

### 1. Domain-Specific System Prompt
The `EVIDENCE_SYSTEM_PROMPT` referenced "audit-grade banking documentation" and contained banking-specific rules.

### 2. Prescriptive Chart Instructions
Lines 344-389 contained a "STEP 4: Write Comprehensive Narrative" that forced narrative generation even when not requested.

### 3. Banking-Specific Examples
All code examples used:
- `ECL/datasets/ECLData.csv`
- Column names like `OUTSTANDING`, `AGE_AT_DEFAULT`
- "Distribution of Outstanding Amounts"

### 4. Automatic Narrative Generation
Lines 989-1045 automatically generated "4-6 sentences" of narrative for all chart blocks, regardless of template instructions.

## Fixes Applied

### Fix 1: Generic System Prompt (Lines 124-144)

**Before:**
```typescript
You are an expert technical documentation writer for banking model documentation.
Generate audit-grade documentation...
```

**After:**
```typescript
You are a technical documentation expert that generates content using ONLY verified evidence from codebases.

## YOUR ROLE
Follow the user's instructions exactly. Generate the specific content they request, in the style they request.

## OUTPUT RULES
1. **Follow instructions exactly**: If asked for an introduction, write an introduction. If asked for charts, generate charts.
2. **Match requested style**: Do NOT add sections, narratives, or structure not requested
3. **No assumptions**: Do NOT assume domain (banking, healthcare, etc.) - work with any codebase

## FOR CHART BLOCKS
- Use the generate_chart tool to create visualizations
- Do NOT write descriptions of charts in your output - just generate them
- Do NOT include markdown image syntax - charts are embedded automatically
- Let the charts speak for themselves
```

### Fix 2: Conditional Narrative Generation (Lines 988-1057)

**Before:**
- Always generated "4-6 sentences" describing charts
- Happened for ALL chart blocks with minimal content

**After:**
```typescript
// Check if instructions ask for descriptions/narrative/analysis
const requestsNarrative = sectionInstructions.toLowerCase().includes('describe') ||
                          sectionInstructions.toLowerCase().includes('explain') ||
                          sectionInstructions.toLowerCase().includes('analyze') ||
                          sectionInstructions.toLowerCase().includes('discuss') ||
                          sectionInstructions.toLowerCase().includes('narrative') ||
                          sectionInstructions.toLowerCase().includes('interpretation');

if (ctx.blockType === 'LLM_CHART' && generatedImages.length > 0 && (!content.trim() || content.length < 100) && requestsNarrative) {
  // Only generate narrative if explicitly requested
  const narrativePrompt = `Write a concise description (2-3 sentences)...`; // Reduced from 4-6
  // max_tokens reduced from 500 to 300
}
```

**Key changes:**
- Narrative only generated if template requests it (keywords: describe, explain, analyze, etc.)
- Reduced from "4-6 sentences" to "2-3 sentences"
- Reduced max_tokens from 500 to 300
- Added log message when charts are generated without narrative

### Fix 3: Generic Chart Workflow (Lines 344-376)

**Before:**
```
**STEP 4: Write Comprehensive Narrative**
- Describe what each chart shows
- Reference the statistical findings from the tables
- Explain key insights and patterns observed
```

**After:**
```
**CHART GENERATION WORKFLOW**

**1. Generate Visualizations**
- Use generate_chart tool to create charts based on the user's instructions
- Consider creating multiple charts if requested: distributions, trends, comparisons, correlations, etc.

**2. Extract Statistics (if requested)**
- Use execute_python_analysis to compute statistics when asked for

**3. Create Tables (if requested)**
- Use create_data_table to present statistics in tabular format when asked

**IMPORTANT:**
- Follow the user's instructions exactly - don't add content they didn't request
```

**Key changes:**
- Removed "STEP 4: Write Comprehensive Narrative"
- Made all steps conditional: "if requested", "when asked for"
- Added: "Follow the user's instructions exactly - don't add content they didn't request"

### Fix 4: Generic Code Examples (Lines 268-322)

**Before:**
```python
df = load_data('ECL/datasets/ECLData.csv')
plt.hist(df['OUTSTANDING'], bins=30)
plt.title('Distribution of Outstanding Amounts')
plt.xlabel('Outstanding Amount')
```

**After:**
```python
df = load_data('data/dataset.csv')
plt.hist(df['column_name'], bins=30)
plt.title('Distribution of Values')
plt.xlabel('Value')
```

**All examples updated:**
- `ECL/datasets/ECLData.csv` → `data/dataset.csv`
- `PD/datasets/file.xlsx` → `data/file.xlsx`
- `df['OUTSTANDING']` → `df['column_name']`
- "Outstanding Amounts" → "Values"

### Fix 5: Generic Narrative Prompt (Line 1038)

**Before:**
```
- Be specific about what data is visualized (e.g., "Distribution of Outstanding Amounts from ECLData dataset")
```

**After:**
```
- Be specific about what data is visualized (e.g., "Distribution of values from dataset.csv")
```

## Testing the Fix

### Before Fix
**Template:**
```
Block 1: Write an introduction for this document
Block 2: Plot graphs showing EDA
```

**Output:**
```
This document provides comprehensive documentation of the Expected Credit Loss (ECL) model
used for IFRS 9 compliance. The model incorporates Probability of Default (PD), Loss Given
Default (LGD), and Exposure at Default (EAD) calculations...

![Chart description](broken-link.png)

Chart 1: Outstanding Amount Distribution

Description: This histogram illustrates the distribution of outstanding loan amounts across
the portfolio. The chart reveals...

[Data Schema Evidence table appears here]

[Actual charts appear at bottom]
```

### After Fix
**Template:**
```
Block 1: Write an introduction for this document
Block 2: Plot graphs showing EDA
```

**Expected Output:**
```
This document provides documentation for the codebase, covering implementation details
and data analysis findings based on verified code evidence.

[Charts appear here immediately - no broken images, no verbose descriptions]
```

If template requests analysis:
```
Block 2: Plot graphs showing EDA and explain the key findings
```

**Expected Output:**
```
[Charts appear here]

The distribution shows the data is right-skewed with a mean of 1234.56. Most values
fall between the 25th percentile (500) and 75th percentile (2000).
```

## Console Log Changes

### New Logs to Look For

**When narrative is NOT requested:**
```
[EvidenceAgent] 3 chart(s) generated, no narrative requested - charts only
```

**When narrative IS requested:**
```
[EvidenceAgent] 3 chart(s) generated and narrative requested, creating description
```

## Impact

### Fixed Issues
✅ No more broken image symbols in output
✅ No more domain-specific content unless present in evidence
✅ No more verbose narratives when template only requests charts
✅ System respects template instructions exactly

### Preserved Functionality
✅ Can still generate narratives when explicitly requested
✅ Can still handle banking documentation when evidence contains banking code
✅ Can still generate comprehensive analysis when template asks for it
✅ All existing optimizations (caching, early termination, etc.) still work

## Migration Notes

**No code changes required for existing templates** - the system is now smarter about following instructions.

**To get narratives** (if you want them), update your template to explicitly request them:
- Before: "Plot graphs showing EDA"
- After: "Plot graphs showing EDA and describe the key findings"

**To get just charts** (as now default), keep instructions simple:
- "Plot graphs showing EDA"
- "Create visualizations for the data"
- "Generate charts"

## Files Modified

1. **apps/web/src/lib/evidence-agent.ts** (Lines 124-144, 268-322, 344-376, 988-1057)
   - Generic system prompt
   - Conditional narrative generation
   - Generic code examples
   - Simplified workflow instructions

## Related Documentation

- [CHANGES_SUMMARY.md](CHANGES_SUMMARY.md) - All bug fixes and optimizations
- [OPTIMIZATION_GUIDE.md](OPTIMIZATION_GUIDE.md) - Integration guide for optimizations

---

**Result**: DocGen now works generically with ANY template and ANY domain, while preserving the ability to generate comprehensive documentation when requested.
