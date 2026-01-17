---
name: BlockPlannerTask
version: "1.0.0"
---

# Task: Create Block Execution Plan

## Block Information

**Block ID**: {{blockId}}
**Block Type**: {{blockType}}
**Block Title**: {{blockTitle}}
**Instructions**: {{instructions}}

## Input References
{{#each inputRefs}}
- Type: {{this.type}}, Description: {{this.description}}
{{/each}}

## Available Context

### Repository Overview
{{repoOverview}}

### Available Artifacts
{{#each artifacts}}
- {{this.filename}} ({{this.type}}, {{this.size}})
{{/each}}

### Previously Generated Blocks
{{#each previousBlocks}}
- {{this.id}}: {{this.title}} ({{this.type}})
{{/each}}

## Constraints

- Output contract: {{outputContract}}
- Citation required: {{requiresCitations}}
- Max tokens available: {{maxTokens}}

## Task

Analyze this block and create an execution plan. Consider:
1. What information is needed to generate this block's content?
2. Can it be retrieved from the codebase via semantic search?
3. Does it require computation (Python sandbox)?
4. Does it need to run repository commands?
5. Does it depend on other blocks?
6. What questions might need user input?

Return a complete BlockPlan JSON object.

