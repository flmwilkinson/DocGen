---
name: TemplateBuilderTask
version: "1.0.0"
---

# Task: Create Template from Document

## Document Information

**Filename**: {{filename}}
**File Type**: {{fileType}}
**Document Category** (if detected): {{category}}

## Extracted Text Content

```
{{documentText}}
```

## Analysis Instructions

1. Parse the document structure to identify all sections and subsections
2. For each section, determine if content is:
   - Static (boilerplate) → STATIC_TEXT block
   - AI-generatable → LLM_TEXT, LLM_TABLE, or LLM_CHART block
   - User-provided → USER_INPUT block
3. Create descriptive instructions for all LLM blocks
4. Identify any form fields or user input requirements

## Output

Return a complete TemplateSchema JSON object. The schema must include:
- A unique templateId (UUID format)
- Descriptive name based on the document
- Proper section hierarchy matching the document structure
- Appropriate block types for each content section
- Clear instructions for LLM blocks
- Field definitions for USER_INPUT blocks

If parts of the document are unclear or could be interpreted multiple ways, make a reasonable default choice and note the ambiguity in the block's instructions.

