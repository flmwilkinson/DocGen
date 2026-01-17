---
name: BlockWriterTask
version: "1.0.0"
---

# Task: Generate Documentation Block

## Block Information

**Section**: {{sectionTitle}}
**Block Title**: {{blockTitle}}
**Instructions**: {{instructions}}

## Template Context

{{#if templateName}}
This is part of a "{{templateName}}" document.
{{/if}}

## Source Context

### Repository Overview
{{#if repoOverview}}
{{repoOverview}}
{{else}}
No repository context provided.
{{/if}}

### Retrieved Code Snippets
{{#each retrievedChunks}}
---
**Source**: `{{this.sourceRef}}` (relevance: {{this.score}})
```
{{this.text}}
```
{{/each}}

{{#unless retrievedChunks}}
No code snippets retrieved.
{{/unless}}

### Additional Artifacts
{{#each artifacts}}
**{{this.name}}** ({{this.type}}):
{{this.summary}}
{{/each}}

{{#unless artifacts}}
No additional artifacts provided.
{{/unless}}

## Previous Block Outputs (Dependencies)
{{#each dependencyOutputs}}
**{{@key}}**:
{{this}}
{{/each}}

{{#unless dependencyOutputs}}
No dependencies.
{{/unless}}

## User-Provided Context
{{#if userContext}}
{{userContext}}
{{else}}
No additional user context.
{{/if}}

---

Generate the documentation content for this block following the instructions. Ensure all claims are grounded in the provided sources and include proper citations.

