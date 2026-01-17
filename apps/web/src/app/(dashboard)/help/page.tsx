'use client';

import { HelpCircle, Book, MessageSquare, Github, Mail } from 'lucide-react';

const faqs = [
  {
    question: 'How do I create my first documentation?',
    answer:
      'Start by creating a project, then select or create a template. Connect your code repository (GitHub URL or file upload) and the AI will analyze it to generate documentation. Click "Generate Doc" to start the process.',
  },
  {
    question: 'What file types are supported for upload?',
    answer:
      'We support CSV, JSON, XLSX, DOCX, PDF, Markdown, ZIP archives, and common code files (Python, JavaScript, TypeScript). You can upload multiple files as reference data during project creation.',
  },
  {
    question: 'How does the AI generation work?',
    answer:
      'DocGen.AI uses OpenAI\'s GPT models (GPT-4o) with specialized prompts and tools to analyze your codebase. It performs semantic code analysis, builds a knowledge graph, and uses ReAct agents to iteratively generate accurate, well-cited documentation.',
  },
  {
    question: 'Can I edit the generated documentation?',
    answer:
      'Yes! Click the edit icon (✏️) on any section to open a rich text editor. You can also use the sparkle icon (✨) to enhance sections with AI by providing specific instructions.',
  },
  {
    question: 'What are gaps and how do I fix them?',
    answer:
      'Gaps are areas where the AI detected missing or uncertain information. Click on a gap in the Gaps tab to fix it - the AI will ask clarifying questions, you can upload additional files, and then it will update the documentation with the new information.',
  },
  {
    question: 'How do I customize documentation templates?',
    answer:
      'Go to the Templates page, click on a template to view it, then click "Edit Template" to modify sections, blocks, and AI prompts. You can also create new templates from scratch or by uploading a reference document.',
  },
  {
    question: 'Where is my data stored?',
    answer:
      'All data (projects, templates, generated documents) is stored locally in your browser using localStorage. This means your data stays private and is not sent to any external servers except OpenAI for document generation.',
  },
  {
    question: 'Do I need an OpenAI API key?',
    answer:
      'Yes, you need an OpenAI API key for document generation. You can add it in Settings. The key is stored locally in your browser and only used to make API calls to OpenAI for generating documentation.',
  },
];

export default function HelpPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Header */}
      <div className="shrink-0 mb-6">
        <h1 className="text-2xl font-semibold">Help & Support</h1>
        <p className="mt-1 text-muted-foreground">
          Get help with DocGen.AI
        </p>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-6">
        {/* Quick Start Guide */}
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 mb-4">
            <Book className="h-5 w-5 text-brand-orange" />
            <h2 className="text-lg font-medium">Quick Start Guide</h2>
          </div>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-orange/20 text-brand-orange font-medium shrink-0">1</span>
              <div>
                <p className="font-medium">Create a Project</p>
                <p className="text-muted-foreground">Click "New Project" and provide your project details</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-orange/20 text-brand-orange font-medium shrink-0">2</span>
              <div>
                <p className="font-medium">Connect Your Code</p>
                <p className="text-muted-foreground">Add a GitHub repository URL or upload code files</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-orange/20 text-brand-orange font-medium shrink-0">3</span>
              <div>
                <p className="font-medium">Select a Template</p>
                <p className="text-muted-foreground">Choose an existing template or create a custom one</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-orange/20 text-brand-orange font-medium shrink-0">4</span>
              <div>
                <p className="font-medium">Generate Documentation</p>
                <p className="text-muted-foreground">Click "Generate Doc" and wait for the AI to analyze your codebase</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-orange/20 text-brand-orange font-medium shrink-0">5</span>
              <div>
                <p className="font-medium">Review & Edit</p>
                <p className="text-muted-foreground">Review the generated documentation, fix any gaps, and customize as needed</p>
              </div>
            </li>
          </ol>
        </div>

        {/* FAQs */}
        <div className="glass-panel p-6">
          <h2 className="text-lg font-medium flex items-center gap-2 mb-6">
            <HelpCircle className="h-5 w-5" />
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {faqs.map((faq, index) => (
              <div key={index} className="border-b border-glass-border pb-6 last:border-0 last:pb-0">
                <h3 className="font-medium mb-2">{faq.question}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Additional Resources */}
        <div className="glass-panel p-6">
          <h2 className="text-lg font-medium mb-4">Additional Resources</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-glass-bg hover:bg-glass-bg-light transition-colors">
              <Github className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Open Source</p>
                <p className="text-xs text-muted-foreground">This is an open-source project</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-glass-bg hover:bg-glass-bg-light transition-colors">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Report Issues</p>
                <p className="text-xs text-muted-foreground">Found a bug or have a feature request? Check the project repository</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

