/**
 * Gap Fixing Agent System
 * 
 * This module provides intelligent gap analysis and fixing capabilities.
 * It uses a two-agent approach:
 * 1. GapAnalyzer: Determines what information is missing and asks clarifying questions
 * 2. GapFixer: Uses full context + user-provided info to generate improved content
 */

import OpenAI from 'openai';
import { DocumentGap, GeneratedSection, GeneratedBlock } from './openai';

// Get OpenAI client
const getOpenAIClient = () => {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-...' || apiKey.includes('...')) {
    throw new Error('OpenAI API key not configured');
  }
  return new OpenAI({ 
    apiKey,
    dangerouslyAllowBrowser: true,
    timeout: 60000,
  });
};

export interface GapContext {
  gap: DocumentGap;
  sectionContent: string;
  fullDocumentContext: string;
  projectName: string;
  repoUrl?: string;
}

export interface UserProvidedInfo {
  text?: string;
  uploadedFiles?: { name: string; content: string }[];
}

export interface GapAnalysisResult {
  questions: string[];
  whatIsMissing: string;
  suggestedInfoTypes: ('file_upload' | 'text_input' | 'code_snippet' | 'link')[];
}

export interface GapFixResult {
  improvedContent: string;
  confidence: number;
  citationsUsed: string[];
}

/**
 * GapAnalyzer Agent
 * Analyzes a gap and determines what SPECIFIC DATA is needed
 */
export async function analyzeGap(context: GapContext): Promise<GapAnalysisResult> {
  console.log('[GapAnalyzer] Analyzing gap:', context.gap.sectionTitle);
  
  const openai = getOpenAIClient();
  
  // Extract any [NEEDS: xxx] markers from content for smarter analysis
  const needsMarkers = context.sectionContent.match(/\[NEEDS:\s*([^\]]+)\]/gi) || [];
  const specificNeeds = needsMarkers.map(m => m.replace(/\[NEEDS:\s*/i, '').replace(/\]$/, ''));
  
  // Determine gap type based on severity and content
  const isMetricsGap = context.gap.description.toLowerCase().includes('metric') || 
                       context.gap.description.toLowerCase().includes('[tbd]') ||
                       context.sectionContent.includes('| [TBD]');
  const isContextGap = specificNeeds.length > 0 || context.gap.severity === 'medium';
  
  const systemPrompt = `You help users complete documentation by identifying what specific information is needed.

## Gap Type
${isMetricsGap ? 'METRICS/VALUES: Need specific numbers (accuracy, latency, etc.)' : ''}
${isContextGap ? 'CONTEXT: Need business/operational context' : ''}
${specificNeeds.length > 0 ? `FLAGGED NEEDS: ${specificNeeds.join(', ')}` : ''}

## Your Job
Ask 1-3 SPECIFIC questions to get the missing information.

Examples of GOOD questions:
- For metrics: "What accuracy/precision/recall did you achieve in testing?"
- For context: "What jurisdictions or regions does this system serve?"
- For business: "Who are the primary end users of this system?"
- For operational: "What is the expected daily transaction volume?"

Examples of BAD questions (too vague):
- "Can you provide more details?"
- "Do you have any documentation?"
- "Can you elaborate on this?"`;

  const userPrompt = `## Gap Details
Section: ${context.gap.sectionTitle}
Problem: ${context.gap.description}
Severity: ${context.gap.severity}

${specificNeeds.length > 0 ? `## Specific Information Flagged as Needed\n${specificNeeds.map(n => `- ${n}`).join('\n')}` : ''}

## Current Section Content
${context.sectionContent.slice(0, 1500)}

---

Based on the gap and flagged needs, what SPECIFIC information should the user provide?

Respond with JSON:
{
  "whatIsMissing": "Brief summary of what's needed",
  "questions": ["Specific question 1", "Specific question 2"],
  "suggestedInfoTypes": ["file_upload" if metrics data, "text_input" for simple answers, "code_snippet" for implementation details]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    const result = JSON.parse(content);
    
    return {
      questions: result.questions || (specificNeeds.length > 0 
        ? specificNeeds.map(n => `Can you provide: ${n}?`)
        : ['What additional information can you provide about this section?']),
      whatIsMissing: result.whatIsMissing || context.gap.description,
      suggestedInfoTypes: result.suggestedInfoTypes || ['text_input'],
    };
  } catch (error) {
    console.error('[GapAnalyzer] Error:', error);
    return {
      questions: specificNeeds.length > 0 
        ? specificNeeds.map(n => `Can you provide: ${n}?`)
        : ['What additional information can you provide about this section?'],
      whatIsMissing: context.gap.description,
      suggestedInfoTypes: ['text_input'],
    };
  }
}

/**
 * GapFixer Agent
 * Uses full context + user-provided information to generate improved content
 */
export async function fixGap(
  context: GapContext,
  userInfo: UserProvidedInfo,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
): Promise<GapFixResult> {
  console.log('[GapFixer] Fixing gap with user-provided info');
  
  const openai = getOpenAIClient();
  
  // Build context from uploaded files
  const uploadedFilesContext = userInfo.uploadedFiles?.map(f => 
    `### File: ${f.name}\n${f.content.slice(0, 2000)}`
  ).join('\n\n') || '';
  
  // Build conversation context
  const conversationContext = conversationHistory.map(m => 
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n');

  const systemPrompt = `You are a documentation writer fixing a gap in technical documentation.

## Your Task
Rewrite the section to incorporate the new information provided by the user.

## Rules
1. ONLY use information explicitly provided by the user or in the document context
2. DO NOT fabricate any technical details, numbers, or specifications
3. If user-provided info is incomplete, acknowledge what's still missing
4. Maintain the same markdown formatting style as the original
5. Be concise and factual`;

  const userPrompt = `## Gap to Fix
- Section: ${context.gap.sectionTitle}
- Problem: ${context.gap.description}

## Current Section Content
${context.sectionContent}

## Full Document Context (for reference)
${context.fullDocumentContext.slice(0, 2000)}

## User-Provided Information
${userInfo.text || 'No additional text provided'}

${uploadedFilesContext ? `## Uploaded Files\n${uploadedFilesContext}` : ''}

## Conversation History
${conversationContext}

---

Generate the improved section content. If the user's information is insufficient, still improve what you can and note what's still missing.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // Calculate confidence based on what info was provided
    const hasUserText = !!userInfo.text && userInfo.text.length > 50;
    const hasFiles = !!userInfo.uploadedFiles && userInfo.uploadedFiles.length > 0;
    const confidence = 0.6 + (hasUserText ? 0.2 : 0) + (hasFiles ? 0.15 : 0);
    
    // Extract any citations
    const citationRegex = /\[([^\]]+\.[a-zA-Z]+(?::\d+-\d+)?)\]/g;
    const citations: string[] = [];
    let match;
    while ((match = citationRegex.exec(content)) !== null) {
      citations.push(match[1]);
    }

    return {
      improvedContent: content,
      confidence: Math.min(confidence, 0.95),
      citationsUsed: citations,
    };
  } catch (error) {
    console.error('[GapFixer] Error:', error);
    throw error;
  }
}

/**
 * Process a chat message in the context of gap fixing
 * Returns an intelligent response based on the conversation state
 */
export async function processGapChat(
  message: string,
  gapContext: GapContext | null,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[],
  uploadedFiles: { name: string; content: string }[]
): Promise<{ response: string; shouldFix: boolean; suggestUpload: boolean }> {
  console.log('[GapChat] Processing message:', message.slice(0, 50));
  
  const openai = getOpenAIClient();
  
  // Build conversation for context
  const historyContext = conversationHistory.slice(-6).map(m => 
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n');

  const systemPrompt = `You are a helpful documentation assistant. You're helping the user fix a gap in their documentation.

Current gap being fixed:
${gapContext ? `- Section: ${gapContext.gap.sectionTitle}\n- Problem: ${gapContext.gap.description}` : 'No specific gap selected'}

Uploaded files: ${uploadedFiles.length > 0 ? uploadedFiles.map(f => f.name).join(', ') : 'None'}

Your response should be JSON:
{
  "response": "Your helpful response to the user",
  "shouldFix": true/false (true if user wants to apply the fix now),
  "suggestUpload": true/false (true if you think they should upload a file)
}

Be conversational and helpful. If the user provides information, acknowledge it and ask if they're ready to apply the fix. If they ask questions, answer them.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Previous conversation:\n${historyContext}\n\nUser's new message: ${message}` }
      ],
      temperature: 0.5,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    const result = JSON.parse(content);
    
    return {
      response: result.response || "I understand. How would you like to proceed?",
      shouldFix: result.shouldFix === true,
      suggestUpload: result.suggestUpload === true,
    };
  } catch (error) {
    console.error('[GapChat] Error:', error);
    return {
      response: "I understand. Would you like to provide more information, or should I try to fix the section with what we have?",
      shouldFix: false,
      suggestUpload: false,
    };
  }
}

