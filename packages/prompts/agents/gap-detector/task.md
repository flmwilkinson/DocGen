---
name: GapDetectorTask
version: "1.0.0"
---

# Task: Analyze Block Output for Gaps

## Block Information

**Block ID**: {{blockId}}
**Block Title**: {{blockTitle}}
**Block Type**: {{blockType}}

## Generated Content

{{generatedContent}}

## Metadata

**Confidence Score**: {{confidence}}
**Number of Citations**: {{citationCount}}

## Citations Used
{{#each citations}}
- Source: {{this.sourceRef}}
  Excerpt: "{{this.excerpt}}"
{{/each}}

## Original Instructions

{{instructions}}

## Analysis Task

Review the generated content and identify:

1. **Missing Information**: What critical details are absent?
2. **Unsupported Claims**: Any statements without adequate citations?
3. **Incomplete Sections**: Parts that seem truncated or vague?
4. **Ambiguities**: Areas that need clarification?
5. **Quality Issues**: Problems with accuracy, clarity, or completeness?

For each gap found, create a specific question that could help fill it.

Return a JSON array of gap objects.

