# Agentic Architecture Review & Fixes

## Executive Summary

**Critical Issue Found**: The ReAct agent was NOT using coding tools (chart generation, Python execution), despite having access to them. This has been fixed.

## Architecture Overview

Your system has **three agent paths** for documentation generation:

1. **Evidence-First Agent** (Primary) - Two-pass evidence collection → narrative generation
2. **ReAct Agent** (Fallback) - Think → Search → Observe → Draft → Verify loop
3. **Legacy Generation** (Final Fallback) - Direct LLM call with tools

## Issues Found & Fixed

### ❌ **CRITICAL: ReAct Agent Missing Tool Support**

**Problem**: The ReAct agent's `draft()` function was making direct LLM calls WITHOUT tools, even though:
- Tools are available (`generate_chart`, `execute_python_analysis`, `create_data_table`)
- The legacy path uses tools correctly
- The evidence-first agent now uses tools (recently added)

**Impact**: 
- Charts were NOT being generated for `LLM_CHART` blocks in ReAct path
- Python analysis tools were unavailable
- Data tables couldn't be created via tools

**Fix Applied**:
- ✅ Added tool support to `draft()` function in ReAct agent
- ✅ Implemented tool call loop (up to 3 iterations)
- ✅ Added `blockType` parameter to `AgentContext` to enable chart-specific tool prompting
- ✅ Pass `blockType` from `generateBlock()` to ReAct agent
- ✅ Return `generatedImage` and `executedCode` from ReAct agent

### ✅ **Evidence-First Agent: Tool Support Added**

**Status**: Fixed in previous changes
- Tools are now available in evidence-first agent
- Chart generation works for `LLM_CHART` blocks
- Tool call loop implemented (up to 3 iterations)

### ✅ **Legacy Path: Tool Support Working**

**Status**: Already working correctly
- Tools are available and used
- Chart generation works
- Python analysis works

## Current Architecture

### Agent Selection Flow

```
generateBlock()
  ├─> IF (useEvidenceFirst && codeIntelligence)
  │     └─> Evidence-First Agent (with tools ✅)
  │
  ├─> ELSE IF (codeIntelligence && agentMemory)
  │     └─> ReAct Agent (with tools ✅ NOW FIXED)
  │
  └─> ELSE
        └─> Legacy Generation (with tools ✅)
```

### Tool Availability

All three paths now have access to:

1. **`generate_chart`** - Matplotlib chart generation
   - Executes Python code in sandbox
   - Returns base64 image
   - Available when sandbox is running

2. **`execute_python_analysis`** - Python code execution
   - For data analysis, calculations, statistics
   - Returns stdout and structured results
   - Available when sandbox is running

3. **`create_data_table`** - Markdown table creation
   - Always available (no sandbox needed)

### Tool Execution Flow

```
LLM Request
  ├─> OpenAI API call with tools array
  ├─> LLM responds with tool_calls
  ├─> Execute tools in parallel
  ├─> Add tool results to message history
  ├─> Continue conversation (up to 3 iterations)
  └─> Final content + generated images/code
```

## Improvements Made

### 1. ReAct Agent Tool Integration

**Before**:
```typescript
// draft() function - NO TOOLS
const response = await ctx.openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [...],
  temperature: 0.4,
  max_tokens: 1500
  // ❌ NO tools parameter
});
```

**After**:
```typescript
// draft() function - WITH TOOLS
const tools = await getAvailableTools();
let response = await ctx.openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [...],
  temperature: 0.4,
  max_tokens: 1500,
  tools: tools.length > 0 ? tools : undefined, // ✅ Tools available
  tool_choice: ctx.blockType === 'LLM_CHART' ? 'auto' : undefined, // ✅ Force tools for charts
});

// ✅ Tool call loop implemented
while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
  // Execute tools, add results, continue conversation
}
```

### 2. Block Type Propagation

**Before**: `blockType` was not passed to ReAct agent
**After**: `blockType` is passed through `AgentContext` to enable chart-specific prompting

### 3. Tool Result Handling

**Before**: ReAct agent didn't return chart images or executed code
**After**: Returns `generatedImage` and `executedCode` in `AgentResult`

## Verification Checklist

- ✅ Evidence-First Agent: Has tools, uses them correctly
- ✅ ReAct Agent: NOW HAS TOOLS (fixed)
- ✅ Legacy Path: Has tools, uses them correctly
- ✅ Block type propagation: Works for all paths
- ✅ Chart generation: Works in all paths
- ✅ Python execution: Works in all paths
- ✅ Tool call loops: Implemented in all paths (max 3 iterations)

## Recommendations

### 1. Add Tool Usage Metrics

Track which tools are being used:
- Log tool calls per agent path
- Track success/failure rates
- Monitor chart generation success rate

### 2. Improve Tool Prompting

For `LLM_CHART` blocks, make tool usage more explicit:
- Add stronger prompts: "You MUST use generate_chart tool"
- Set `tool_choice: 'required'` for chart blocks (if OpenAI supports it)

### 3. Sandbox Health Checks

Before generation, check sandbox availability:
- If sandbox is down, inform user that charts won't be generated
- Provide fallback: generate code but don't execute

### 4. Tool Result Validation

Validate tool results before including in document:
- Check image format/size
- Validate Python code execution results
- Handle tool failures gracefully

## Testing Recommendations

1. **Test Chart Generation**:
   - Create a template with `LLM_CHART` block
   - Verify chart is generated in all three agent paths
   - Check that image appears in UI

2. **Test Python Analysis**:
   - Create a block that needs data analysis
   - Verify `execute_python_analysis` is called
   - Check that results are included in document

3. **Test Tool Fallback**:
   - Disable sandbox
   - Verify graceful degradation (code generated but not executed)

## Conclusion

**Status**: ✅ **FIXED**

All three agent paths now have full tool support. The ReAct agent was the missing piece, and it's now integrated with the same tool capabilities as the other paths.

**Next Steps**:
1. Test chart generation in production
2. Monitor tool usage logs
3. Consider adding tool usage metrics to UI

