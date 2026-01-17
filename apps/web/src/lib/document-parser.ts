/**
 * Document Parser - Extracts structure from uploaded documents
 * 
 * This module handles:
 * 1. DOCX parsing with heading style detection
 * 2. Text extraction and chunking
 * 3. Table detection
 * 4. LLM-based structure inference for unformatted documents
 */

import OpenAI from 'openai';

// Types for document structure
export interface DocumentHeading {
  level: number; // 1-6
  text: string;
  startIndex: number;
}

export interface DocumentTable {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface DocumentChunk {
  type: 'heading' | 'paragraph' | 'table' | 'list' | 'code';
  content: string;
  level?: number; // For headings
  tableData?: DocumentTable; // For tables
  parentHeading?: string;
}

export interface ParsedDocument {
  title: string;
  chunks: DocumentChunk[];
  headings: DocumentHeading[];
  hasProperFormatting: boolean;
}

export interface TemplateSection {
  id: string;
  title: string;
  description: string;
  blocks: TemplateBlock[];
}

export interface TemplateBlock {
  id: string;
  type: 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART';
  title: string;
  instructions: string;
  dataSources: string[];
}

export interface GeneratedTemplate {
  name: string;
  description: string;
  sections: TemplateSection[];
}

/**
 * Parse a DOCX file and extract its structure
 * Uses mammoth.js on the client side to extract text and styles
 */
export async function parseDocxFile(file: File): Promise<ParsedDocument> {
  // Dynamically import mammoth for DOCX parsing
  const mammoth = await import('mammoth');
  
  const arrayBuffer = await file.arrayBuffer();
  
  // Extract with style information
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "p[style-name='Heading 5'] => h5:fresh",
      "p[style-name='Heading 6'] => h6:fresh",
      "p[style-name='Title'] => h1.title:fresh",
    ],
  });
  
  const html = result.value;
  
  // Parse HTML to extract structure
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const chunks: DocumentChunk[] = [];
  const headings: DocumentHeading[] = [];
  let currentHeading = '';
  let charIndex = 0;
  
  // Walk through all elements
  // Note: We iterate through children instead of TreeWalker for better compatibility
  const elements = doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, table, ul, ol');
  
  elements.forEach((element) => {
    const tagName = element.tagName?.toLowerCase();
    const textContent = element.textContent?.trim() || '';
    
    if (!textContent) return;
    
    // Detect headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName.charAt(1));
      headings.push({
        level,
        text: textContent,
        startIndex: charIndex,
      });
      chunks.push({
        type: 'heading',
        content: textContent,
        level,
      });
      currentHeading = textContent;
    }
    // Detect tables
    else if (tagName === 'table') {
      const tableData = extractTableData(element as HTMLTableElement);
      chunks.push({
        type: 'table',
        content: JSON.stringify(tableData),
        tableData,
        parentHeading: currentHeading,
      });
    }
    // Detect lists
    else if (tagName === 'ul' || tagName === 'ol') {
      const listItems = Array.from(element.querySelectorAll('li'))
        .map(li => li.textContent?.trim() || '')
        .filter(Boolean);
      if (listItems.length > 0) {
        chunks.push({
          type: 'list',
          content: listItems.join('\n'),
          parentHeading: currentHeading,
        });
      }
    }
    // Detect paragraphs
    else if (tagName === 'p') {
      if (textContent.length > 20) { // Skip very short paragraphs
        chunks.push({
          type: 'paragraph',
          content: textContent,
          parentHeading: currentHeading,
        });
      }
    }
    
    charIndex += textContent.length;
  });
  
  // Determine if document has proper formatting
  const hasProperFormatting = headings.length >= 2;
  
  // Extract title from first H1 or file name
  const titleHeading = headings.find(h => h.level === 1);
  const title = titleHeading?.text || file.name.replace(/\.[^.]+$/, '');
  
  return {
    title,
    chunks,
    headings,
    hasProperFormatting,
  };
}

/**
 * Extract table data from an HTML table element
 */
function extractTableData(table: HTMLTableElement): DocumentTable {
  const headers: string[] = [];
  const rows: string[][] = [];
  
  // Get headers from thead or first row
  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (headerRow) {
    const headerCells = headerRow.querySelectorAll('th, td');
    headerCells.forEach(cell => {
      headers.push(cell.textContent?.trim() || '');
    });
  }
  
  // Get data rows
  const bodyRows = table.querySelectorAll('tbody tr, tr');
  bodyRows.forEach((row, idx) => {
    // Skip header row if it's the first
    if (idx === 0 && row === headerRow) return;
    
    const rowData: string[] = [];
    row.querySelectorAll('td').forEach(cell => {
      rowData.push(cell.textContent?.trim() || '');
    });
    if (rowData.length > 0) {
      rows.push(rowData);
    }
  });
  
  return { headers, rows };
}

/**
 * Parse plain text file into chunks
 */
export async function parseTextFile(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  const lines = text.split('\n');
  
  const chunks: DocumentChunk[] = [];
  const headings: DocumentHeading[] = [];
  let currentHeading = '';
  let charIndex = 0;
  let paragraphBuffer = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect markdown-style headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Flush paragraph buffer
      if (paragraphBuffer.trim()) {
        chunks.push({
          type: 'paragraph',
          content: paragraphBuffer.trim(),
          parentHeading: currentHeading,
        });
        paragraphBuffer = '';
      }
      
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      headings.push({ level, text, startIndex: charIndex });
      chunks.push({ type: 'heading', content: text, level });
      currentHeading = text;
    }
    // Detect uppercase headings (all caps, short)
    else if (trimmed.length > 0 && trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      if (paragraphBuffer.trim()) {
        chunks.push({
          type: 'paragraph',
          content: paragraphBuffer.trim(),
          parentHeading: currentHeading,
        });
        paragraphBuffer = '';
      }
      
      headings.push({ level: 2, text: trimmed, startIndex: charIndex });
      chunks.push({ type: 'heading', content: trimmed, level: 2 });
      currentHeading = trimmed;
    }
    // Accumulate paragraph text
    else if (trimmed) {
      paragraphBuffer += ' ' + trimmed;
    }
    // Empty line = end of paragraph
    else if (paragraphBuffer.trim()) {
      chunks.push({
        type: 'paragraph',
        content: paragraphBuffer.trim(),
        parentHeading: currentHeading,
      });
      paragraphBuffer = '';
    }
    
    charIndex += line.length + 1;
  }
  
  // Flush remaining
  if (paragraphBuffer.trim()) {
    chunks.push({
      type: 'paragraph',
      content: paragraphBuffer.trim(),
      parentHeading: currentHeading,
    });
  }
  
  const hasProperFormatting = headings.length >= 2;
  const title = headings.find(h => h.level === 1)?.text || file.name.replace(/\.[^.]+$/, '');
  
  return { title, chunks, headings, hasProperFormatting };
}

/**
 * Use LLM to infer document structure when formatting is absent
 */
export async function inferDocumentStructure(
  rawText: string,
  fileName: string
): Promise<{ sections: { title: string; content: string; type: 'text' | 'table' }[] }> {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a document structure analyzer. Given raw text from a document, identify the logical sections and their content.

Output JSON in this format:
{
  "documentTitle": "string",
  "sections": [
    {
      "title": "Section name",
      "content": "The full content of this section",
      "type": "text" | "table",
      "subsections": [
        { "title": "...", "content": "...", "type": "text" | "table" }
      ]
    }
  ]
}

Rules:
- Look for natural breaks in content (topic changes, numbered lists, etc.)
- Identify if content looks like tabular data (columns of aligned data)
- Create meaningful section titles that describe the content
- Preserve all content, don't summarize
- Group related paragraphs under the same section`,
      },
      {
        role: 'user',
        content: `Analyze this document and identify its sections:\n\nFilename: ${fileName}\n\n${rawText.slice(0, 15000)}`,
      },
    ],
  });
  
  const result = JSON.parse(response.choices[0].message.content || '{}');
  return result;
}

/**
 * Generate detailed LLM prompts for each template block
 */
export async function generateBlockPrompts(
  sections: { title: string; content: string; type: string }[],
  documentTitle: string
): Promise<TemplateSection[]> {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  
  const templateSections: TemplateSection[] = [];
  
  for (const section of sections) {
    // Analyze the section content to create an appropriate prompt
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are creating a documentation template. Given a section from an example document, create a detailed prompt that will guide an LLM to generate similar content for a new project.

Output JSON:
{
  "blockTitle": "string - descriptive title for this block",
  "blockType": "LLM_TEXT" | "LLM_TABLE",
  "prompt": "string - detailed instructions for the LLM to generate this content",
  "dataSources": ["array of suggested data sources the LLM should reference"],
  "description": "string - brief description of this section's purpose"
}

Rules:
- Analyze WHAT kind of content this is (overview, technical details, metrics, requirements, etc.)
- Create a prompt that captures the STRUCTURE and INTENT, not the specific content
- Suggest relevant data sources (code files, configs, README, etc.)
- If it's tabular data, use LLM_TABLE type
- Make prompts specific enough to guide generation but general enough to apply to any project`,
        },
        {
          role: 'user',
          content: `Create a template prompt for this section:

Section Title: ${section.title}
Content Type: ${section.type}
Sample Content:
${section.content.slice(0, 3000)}`,
        },
      ],
    });
    
    const blockInfo = JSON.parse(response.choices[0].message.content || '{}');
    
    templateSections.push({
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: section.title,
      description: blockInfo.description || `Section: ${section.title}`,
      blocks: [
        {
          id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: blockInfo.blockType || 'LLM_TEXT',
          title: blockInfo.blockTitle || section.title,
          instructions: blockInfo.prompt || `Generate content for the ${section.title} section.`,
          dataSources: blockInfo.dataSources || ['Repository codebase'],
        },
      ],
    });
  }
  
  return templateSections;
}

/**
 * Main function: Process uploaded document and create a template
 */
export async function processDocumentToTemplate(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<GeneratedTemplate> {
  onProgress?.(5, 'Reading document...');
  
  let parsed: ParsedDocument;
  
  // Parse based on file type
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'docx') {
    onProgress?.(10, 'Parsing DOCX structure...');
    parsed = await parseDocxFile(file);
  } else if (ext === 'txt' || ext === 'md') {
    onProgress?.(10, 'Parsing text structure...');
    parsed = await parseTextFile(file);
  } else {
    // Try to read as text
    const text = await file.text();
    parsed = {
      title: file.name.replace(/\.[^.]+$/, ''),
      chunks: [{ type: 'paragraph', content: text }],
      headings: [],
      hasProperFormatting: false,
    };
  }
  
  console.log('[DocParser] Parsed document:', {
    title: parsed.title,
    headings: parsed.headings.length,
    chunks: parsed.chunks.length,
    hasProperFormatting: parsed.hasProperFormatting,
  });
  
  let sections: { title: string; content: string; type: string }[];
  
  // If document has proper heading structure, use it directly
  if (parsed.hasProperFormatting && parsed.headings.length >= 2) {
    onProgress?.(30, 'Extracting sections from document headings...');
    
    // Group chunks by heading
    sections = [];
    let currentSection: { title: string; content: string; type: string } | null = null;
    
    for (const chunk of parsed.chunks) {
      if (chunk.type === 'heading' && chunk.level && chunk.level <= 2) {
        // Start a new section
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: chunk.content,
          content: '',
          type: 'text',
        };
      } else if (currentSection) {
        // Add to current section
        if (chunk.type === 'table') {
          // If this section becomes primarily a table, mark it
          currentSection.type = 'table';
          currentSection.content += '\n' + chunk.content;
        } else {
          currentSection.content += '\n' + chunk.content;
        }
      } else {
        // Content before any heading - create intro section
        if (!currentSection) {
          currentSection = {
            title: 'Introduction',
            content: chunk.content,
            type: chunk.type === 'table' ? 'table' : 'text',
          };
        }
      }
    }
    
    if (currentSection) {
      sections.push(currentSection);
    }
  } else {
    // No proper formatting - use LLM to infer structure
    onProgress?.(30, 'Analyzing document structure with AI...');
    
    const fullText = parsed.chunks.map(c => c.content).join('\n\n');
    const inferred = await inferDocumentStructure(fullText, file.name);
    
    sections = inferred.sections || [];
  }
  
  if (sections.length === 0) {
    // Fallback: create a single section from all content
    sections = [{
      title: 'Document Content',
      content: parsed.chunks.map(c => c.content).join('\n\n'),
      type: 'text',
    }];
  }
  
  console.log('[DocParser] Identified sections:', sections.map(s => s.title));
  
  // Generate prompts for each section
  onProgress?.(50, `Generating template prompts for ${sections.length} sections...`);
  
  const templateSections = await generateBlockPrompts(sections, parsed.title);
  
  onProgress?.(90, 'Finalizing template...');
  
  return {
    name: parsed.title,
    description: `Template generated from ${file.name}`,
    sections: templateSections,
  };
}

