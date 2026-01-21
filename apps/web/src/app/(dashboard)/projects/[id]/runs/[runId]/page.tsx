'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import { toast } from 'sonner';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import {
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  RefreshCw,
  Download,
  Share,
  AlertCircle,
  Send,
  Code,
  Loader2,
  Sparkles,
  Plus,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  X,
  Edit3,
  Check,
  AlertTriangle,
  FileWarning,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjectsStore, selectProject, selectRun, type GeneratedSection, type GeneratedBlock, type DocumentGap, type ChatMessage } from '@/store/projects';
import { analyzeGap, fixGap, processGapChat, type GapContext, type GapAnalysisResult } from '@/lib/gap-agent';

// TipTap Toolbar Component
function EditorToolbar({ editor, onCancel }: { editor: any; onCancel: () => void }) {
  if (!editor) return null;
  
  return (
    <div className="flex items-center justify-between p-2 border-b border-glass-border bg-background/80 rounded-t-lg">
      <div className="flex items-center gap-1">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('bold') && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('italic') && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </button>
        <div className="w-px h-6 bg-glass-border mx-1" />
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('heading', { level: 1 }) && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Heading 1"
        >
          <Heading1 className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('heading', { level: 2 }) && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Heading 2"
        >
          <Heading2 className="h-4 w-4" />
        </button>
        <div className="w-px h-6 bg-glass-border mx-1" />
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('bulletList') && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('orderedList') && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Numbered List"
        >
          <ListOrdered className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={cn(
            "p-2 rounded hover:bg-glass-bg transition-colors",
            editor.isActive('blockquote') && "bg-brand-orange/20 text-brand-orange"
          )}
          title="Quote"
        >
          <Quote className="h-4 w-4" />
        </button>
      </div>
      <button
        onClick={onCancel}
        className="p-2 rounded hover:bg-glass-bg text-muted-foreground hover:text-foreground transition-colors"
        title="Exit edit mode (Esc)"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Block Editor Component with TipTap
function BlockEditor({
  block,
  sectionId,
  onSave,
  onCancel,
}: {
  block: GeneratedBlock;
  sectionId: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  // Convert markdown to HTML for TipTap (simple conversion)
  const initialHtml = block.content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^\- (.*$)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n/g, '<br>');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      Highlight,
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none p-4 min-h-[200px] focus:outline-none text-foreground/90',
      },
    },
  });

  // Handle Escape key to exit edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleSave = () => {
    if (!editor) return;
    
    // Convert HTML back to markdown (simplified)
    let html = editor.getHTML();
    let markdown = html
      .replace(/<h1>(.*?)<\/h1>/g, '# $1\n')
      .replace(/<h2>(.*?)<\/h2>/g, '## $1\n')
      .replace(/<h3>(.*?)<\/h3>/g, '### $1\n')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<em>(.*?)<\/em>/g, '*$1*')
      .replace(/<li><p>(.*?)<\/p><\/li>/g, '- $1\n')
      .replace(/<li>(.*?)<\/li>/g, '- $1\n')
      .replace(/<ul>|<\/ul>/g, '')
      .replace(/<ol>|<\/ol>/g, '')
      .replace(/<blockquote><p>(.*?)<\/p><\/blockquote>/g, '> $1\n')
      .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
      .replace(/<br>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .trim();
    
    onSave(markdown);
  };

  return (
    <div className="border-2 border-brand-orange/50 rounded-xl bg-background overflow-hidden shadow-xl shadow-brand-orange/10 my-4">
      <EditorToolbar editor={editor} onCancel={onCancel} />
      <div className="bg-background min-h-[120px]">
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-between items-center p-3 border-t border-glass-border bg-background/90">
        <span className="text-xs text-muted-foreground">Press Esc to cancel</span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-ghost text-sm px-4 py-1.5">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary text-sm px-4 py-1.5">
            <Check className="h-4 w-4 mr-1" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Gap Card Component
function GapCard({ 
  gap, 
  onFix,
  onHighlight,
  isActive
}: { 
  gap: DocumentGap; 
  onFix: (gap: DocumentGap) => void;
  onHighlight: (gap: DocumentGap) => void;
  isActive?: boolean;
}) {
  const isMissing = gap.severity === 'critical' || gap.severity === 'high';
  const severityStyles = isMissing
    ? 'border-red-500/50 bg-red-500/10'
    : 'border-yellow-500/50 bg-yellow-500/10';
  
  const severityIcon = isMissing
    ? <AlertTriangle className="h-4 w-4 text-red-400" />
    : <FileWarning className="h-4 w-4 text-yellow-400" />;

  return (
    <div 
      className={cn(
        "rounded-lg border p-3 mb-3 transition-all cursor-pointer",
        severityStyles,
        isActive && "ring-2 ring-brand-orange"
      )}
      onClick={() => onHighlight(gap)}
    >
      <div className="flex items-start gap-2">
        {severityIcon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{gap.sectionTitle}</p>
          <p className="text-xs text-muted-foreground mt-1">{gap.description}</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFix(gap);
            }}
            className="text-xs text-brand-orange hover:underline mt-2 flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3" />
            {isActive ? 'Continue Fixing' : 'Fix with AI'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentEditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const runId = params.runId as string;
  
  // State
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chatTab, setChatTab] = useState<'chat' | 'gaps'>('gaps');
  const [chatInput, setChatInput] = useState('');
  const [editingBlock, setEditingBlock] = useState<string | null>(null);
  const [regeneratingBlock, setRegeneratingBlock] = useState<string | null>(null);
  const [aiPromptBlock, setAiPromptBlock] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  
  // Gap fixing state
  const [activeGap, setActiveGap] = useState<DocumentGap | null>(null);
  const [highlightedGap, setHighlightedGap] = useState<DocumentGap | null>(null);
  const [isAnalyzingGap, setIsAnalyzingGap] = useState(false);
  const [isFixingGap, setIsFixingGap] = useState(false);
  const [gapUploadedFiles, setGapUploadedFiles] = useState<{ name: string; content: string }[]>([]);
  const [gapUserInfo, setGapUserInfo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Handle gap highlight (when clicking on gap in list)
  const handleGapHighlight = (gap: DocumentGap) => {
    setHighlightedGap(gap);
    // Find and scroll to section
    const section = run?.sections?.find(s => s.id === gap.sectionId || s.title === gap.sectionTitle);
    if (section) {
      setActiveSection(section.id);
      setTimeout(() => {
        sectionRefs.current[section.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  };
  
  // Store - use optimized selectors
  const run = useProjectsStore(selectRun(runId));
  const project = useProjectsStore(selectProject(projectId));
  const updateRun = useProjectsStore((state) => state.updateRun);

  // Chat messages from store or initialize
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // Refs for scrolling
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const documentContainerRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  
  // Smooth scroll reveal animation using Intersection Observer
  useEffect(() => {
    const rootElement = contentScrollRef.current;
    if (!rootElement) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-in');
            entry.target.classList.remove('opacity-0', 'translate-y-4');
          }
        });
      },
      {
        threshold: 0.1,
        root: rootElement,
        rootMargin: '0px 0px -50px 0px',
      }
    );

    // Observe all sections
    Object.values(sectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      Object.values(sectionRefs.current).forEach((ref) => {
        if (ref) observer.unobserve(ref);
      });
    };
  }, [run.sections]);
  
  // Smooth scroll to section with easing
  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const section = sectionRefs.current[sectionId];
    const scrollContainer = contentScrollRef.current;
    if (section && scrollContainer) {
      const offset = 80; // Account for toolbar and padding
      const sectionRect = section.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const offsetPosition = sectionRect.top - containerRect.top + scrollContainer.scrollTop - offset;

      scrollContainer.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }
  }, []);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize chat from store
  useEffect(() => {
    if (run) {
      if (run.chatMessages && run.chatMessages.length > 0) {
        setChatMessages(run.chatMessages);
      } else if (run.sections) {
        const initialMessage: ChatMessage = {
          id: 'm1',
          role: 'assistant',
          content: `I've generated your **${run.templateName}** document with ${run.sections.length} sections.${run.gaps && run.gaps.length > 0 ? `\n\n⚠️ I found **${run.gaps.length} gap(s)** that need attention. Check the Gaps tab to review them.` : ' The document looks complete!'}\n\nClick any section to edit it with the rich text editor, or use the ✨ button to enhance with AI.`,
          timestamp: new Date(),
        };
        setChatMessages([initialMessage]);
      }
      if (!activeSection && run.sections && run.sections.length > 0) {
        setActiveSection(run.sections[0].id);
      }
    }
  }, [run?.id]);

  // Save chat messages to store when they change
  useEffect(() => {
    if (chatMessages.length > 0) {
      updateRun(runId, { chatMessages });
    }
  }, [chatMessages]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Handle block edit save
  const saveBlockEdit = (sectionId: string, blockId: string, newContent: string) => {
    if (!run?.sections) return;
    
    const updatedSections = run.sections.map(section => {
      if (section.id === sectionId) {
        return {
          ...section,
          blocks: section.blocks.map(block => 
            block.id === blockId ? { ...block, content: newContent } : block
          )
        };
      }
      return section;
    });
    
    updateRun(runId, { sections: updatedSections });
    setEditingBlock(null);
    
    // Add chat message
    addChatMessage('assistant', 'Section updated successfully! Your changes have been saved.');
  };

  // Add chat message helper
  const addChatMessage = (role: 'user' | 'assistant', content: string) => {
    setChatMessages(prev => [...prev, {
      id: `m${Date.now()}`,
      role,
      content,
      timestamp: new Date(),
    }]);
  };

  // Handle AI enhancement
  const handleAiEnhance = async (sectionId: string, blockId: string, prompt?: string) => {
    if (!run?.sections) return;
    
    const enhancePrompt = prompt || aiPrompt;
    if (!enhancePrompt.trim()) return;
    
    setRegeneratingBlock(blockId);
    setAiPromptBlock(null);
    setAiPrompt('');
    
    // Find the block
    const section = run.sections.find(s => s.id === sectionId);
    const block = section?.blocks.find(b => b.id === blockId);
    if (!block) return;

    addChatMessage('user', `Enhance "${block.title}": ${enhancePrompt}`);

    try {
      const OpenAI = (await import('openai')).default;
      const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      if (!apiKey) throw new Error('API key not configured');
      
      const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: `You are a documentation assistant. Enhance the provided content based on the user's request. 
            - Maintain professional technical documentation style
            - Use markdown formatting (bold, italics, headers, lists)
            - Be specific and detailed
            - Keep the same general structure unless asked to change it` 
          },
          { 
            role: 'user', 
            content: `Current content:\n\n${block.content}\n\n---\n\nUser request: ${enhancePrompt}\n\nProvide the enhanced content:` 
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const newContent = response.choices[0]?.message?.content || block.content;
      
      // Update the block
      const updatedSections = run.sections.map(s => {
        if (s.id === sectionId) {
          return {
            ...s,
            blocks: s.blocks.map(b => 
              b.id === blockId ? { ...b, content: newContent, confidence: 0.9 } : b
            )
          };
        }
        return s;
      });
      
      updateRun(runId, { sections: updatedSections });
      addChatMessage('assistant', `Done! I've updated the "${block.title}" section based on your request. The content has been enhanced and saved.`);
      
    } catch (error) {
      console.error('AI enhancement failed:', error);
      addChatMessage('assistant', `Sorry, enhancement failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRegeneratingBlock(null);
    }
  };

  // Handle gap fix - starts the interactive gap fixing flow
  const handleFixGap = async (gap: DocumentGap) => {
    // Clear any previous gap context and start fresh
    setActiveGap(gap);
    setHighlightedGap(gap);
    setChatTab('chat');
    setIsChatOpen(true);
    setIsAnalyzingGap(true);
    setGapUploadedFiles([]);
    setGapUserInfo('');
    
    // Clear previous chat messages for this gap - start fresh conversation
    setChatMessages([{
      id: `m-${Date.now()}`,
      role: 'assistant',
      content: `Starting gap fix for **${gap.sectionTitle}**...`,
      timestamp: new Date(),
    }]);
    
    // Find the section and scroll to it
    const section = run?.sections?.find(s => s.id === gap.sectionId || s.title === gap.sectionTitle);
    if (section) {
      setActiveSection(section.id);
      setTimeout(() => {
        sectionRefs.current[section.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
    
    const sectionContent = section?.blocks.map(b => b.content).join('\n\n') || '';
    
    // Build full document context
    const fullDocContext = run?.sections?.map(s => 
      `## ${s.title}\n${s.blocks.map(b => b.content.slice(0, 500)).join('\n')}`
    ).join('\n\n') || '';
    
    addChatMessage('assistant', `I'm analyzing the gap in **${gap.sectionTitle}**...\n\n*Problem:* ${gap.description}`);
    
    try {
      // Use the GapAnalyzer agent to understand what's missing
      const gapContext: GapContext = {
        gap,
        sectionContent,
        fullDocumentContext: fullDocContext,
        projectName: project?.name || 'Unknown',
        repoUrl: project?.repoUrl,
      };
      
      const analysis = await analyzeGap(gapContext);
      
      // Ask clarifying questions
      let response = `**What's missing:** ${analysis.whatIsMissing}\n\n`;
      response += `**To fix this, I need:**\n`;
      analysis.questions.forEach((q, i) => {
        response += `${i + 1}. ${q}\n`;
      });
      
      if (analysis.suggestedInfoTypes.includes('file_upload')) {
        response += `\n📎 You can **upload a file** with relevant information using the button below.`;
      }
      
      response += `\n\n*Provide the information above, then say "fix it" or "apply" when ready.*`;
      
      addChatMessage('assistant', response);
    } catch (error) {
      console.error('Gap analysis failed:', error);
      addChatMessage('assistant', `I couldn't analyze this gap automatically. Please describe what information should go in the "${gap.sectionTitle}" section, and I'll help you fix it.`);
    } finally {
      setIsAnalyzingGap(false);
    }
  };
  
  // Handle file upload for gap fixing
  const handleGapFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const uploadedFiles: { name: string; content: string }[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const content = await file.text();
        uploadedFiles.push({ name: file.name, content });
      } catch (error) {
        console.error('Failed to read file:', file.name);
      }
    }
    
    setGapUploadedFiles(prev => [...prev, ...uploadedFiles]);
    
    if (uploadedFiles.length > 0) {
      addChatMessage('user', `📎 Uploaded: ${uploadedFiles.map(f => f.name).join(', ')}`);
      addChatMessage('assistant', `Got it! I've received ${uploadedFiles.length} file(s). I'll use this information when fixing the gap.\n\nProvide any additional context, or say "fix it" when ready.`);
    }
  };
  
  // Apply the gap fix
  const applyGapFix = async () => {
    if (!activeGap || !run?.sections) return;
    
    setIsFixingGap(true);
    addChatMessage('assistant', `Fixing the gap in **${activeGap.sectionTitle}**...`);
    
    const section = run.sections.find(s => s.id === activeGap.sectionId || s.title === activeGap.sectionTitle);
    const sectionContent = section?.blocks.map(b => b.content).join('\n\n') || '';
    
    const fullDocContext = run.sections.map(s => 
      `## ${s.title}\n${s.blocks.map(b => b.content.slice(0, 500)).join('\n')}`
    ).join('\n\n');
    
    const gapContext: GapContext = {
      gap: activeGap,
      sectionContent,
      fullDocumentContext: fullDocContext,
      projectName: project?.name || 'Unknown',
      repoUrl: project?.repoUrl,
    };
    
    // Get conversation history for context
    const recentMessages = chatMessages.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    
    try {
      const result = await fixGap(
        gapContext,
        { text: gapUserInfo, uploadedFiles: gapUploadedFiles },
        recentMessages
      );
      
      // Update the section with the improved content
      if (section && section.blocks.length > 0) {
        const updatedSections = run.sections.map(s => {
          if (s.id === section.id) {
            return {
              ...s,
              blocks: s.blocks.map((b, idx) => 
                idx === 0 ? { ...b, content: result.improvedContent, confidence: result.confidence } : b
              )
            };
          }
          return s;
        });
        
        // Remove the gap from the list
        const updatedGaps = (run.gaps || []).filter(g => g.id !== activeGap.id);
        
        updateRun(runId, { sections: updatedSections, gaps: updatedGaps });
        
        addChatMessage('assistant', `✅ **Fixed!** I've updated the "${activeGap.sectionTitle}" section.\n\n*Confidence: ${Math.round(result.confidence * 100)}%*\n\nReview the changes above. If you need further adjustments, let me know!`);
        
        // Reset gap fixing state
        setActiveGap(null);
        setHighlightedGap(null);
        setGapUploadedFiles([]);
        setGapUserInfo('');
      }
    } catch (error) {
      console.error('Gap fix failed:', error);
      addChatMessage('assistant', `Sorry, I couldn't fix this gap automatically. Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\nYou can try providing more specific information or edit the section manually.`);
    } finally {
      setIsFixingGap(false);
    }
  };

  // Handle chat send
  const handleChatSend = async () => {
    if (!chatInput.trim()) return;
    
    const userMessage = chatInput;
    setChatInput('');
    addChatMessage('user', userMessage);
    
    // If we're in gap fixing mode
    if (activeGap) {
      // Store user info for gap fixing
      setGapUserInfo(prev => prev + '\n' + userMessage);
      
      // Check if user wants to apply the fix
      const applyCommands = ['fix it', 'apply', 'do it', 'go ahead', "let's go", 'fix', 'apply fix', 'generate', 'ready'];
      const isApplyCommand = applyCommands.some(cmd => 
        userMessage.toLowerCase().includes(cmd)
      );
      
      if (isApplyCommand) {
        await applyGapFix();
        return;
      }
      
      // Process the chat with gap context
      try {
        const section = run?.sections?.find(s => s.id === activeGap.sectionId || s.title === activeGap.sectionTitle);
        const gapContext: GapContext = {
          gap: activeGap,
          sectionContent: section?.blocks.map(b => b.content).join('\n\n') || '',
          fullDocumentContext: '',
          projectName: project?.name || 'Unknown',
          repoUrl: project?.repoUrl,
        };
        
        const response = await processGapChat(
          userMessage,
          gapContext,
          chatMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          gapUploadedFiles
        );
        
        addChatMessage('assistant', response.response);
        
        if (response.shouldFix) {
          await applyGapFix();
        }
      } catch (error) {
        addChatMessage('assistant', "Thanks for the information! I've noted that. When you're ready, say 'fix it' to apply the changes, or continue providing more details.");
      }
      return;
    }
    
    // Check if it's a command to edit a specific section
    const sectionMatch = userMessage.toLowerCase().match(/(?:edit|update|improve|enhance|fix)\s+(?:the\s+)?['""]?([^'""\n]+)['""]?/i);
    
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      const section = run?.sections?.find(s => 
        s.title.toLowerCase().includes(sectionName.toLowerCase())
      );
      
      if (section && section.blocks.length > 0) {
        addChatMessage('assistant', `I'll enhance the "${section.title}" section for you...`);
        await handleAiEnhance(section.id, section.blocks[0].id, userMessage);
        return;
      }
    }
    
    // General response
    addChatMessage('assistant', `I understand you want to modify the document. You can:\n\n1. **Click a section** in the outline and click ✏️ to edit directly\n2. **Click ✨** on any section to enhance with AI\n3. **Check the Gaps tab** to see areas that need attention\n\nOr tell me specifically which section you'd like me to improve!`);
  };

  // Loading state
  if (!run) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-medium">Document not found</h2>
          <Link href={`/projects/${projectId}`} className="text-brand-orange hover:underline text-sm">
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  if (run.status === 'RUNNING' || !run.sections) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-brand-orange mx-auto mb-4" />
          <h2 className="text-lg font-medium">Generating document...</h2>
          <p className="text-sm text-muted-foreground">{run.progress}% complete</p>
        </div>
      </div>
    );
  }

  const gaps = run.gaps || [];
  const sortedGaps = useMemo(() => {
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return [...gaps].sort((a, b) => {
      const aOrder = severityOrder[a.severity] ?? 99;
      const bOrder = severityOrder[b.severity] ?? 99;
      return aOrder - bOrder;
    });
  }, [gaps]);

  const sanitizeFilename = useCallback((name: string) => {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }, []);

  const buildMarkdown = useCallback(() => {
    const title = run?.documentTitle || run?.templateName || 'Document';
    const lines: string[] = [`# ${title}`, ''];

    const appendSections = (sections: GeneratedSection[], depth: number) => {
      sections.forEach((section) => {
        const headingLevel = Math.min(depth, 6);
        lines.push(`${'#'.repeat(headingLevel)} ${section.title}`, '');

        section.blocks.forEach((block) => {
          if (typeof block.content === 'string') {
            const trimmed = block.content.trim();
            if (trimmed) {
              lines.push(trimmed, '');
            }
          } else {
            lines.push('```json', JSON.stringify(block.content, null, 2), '```', '');
          }

          if (block.citations && block.citations.length > 0) {
            lines.push('_Sources:_');
            block.citations.forEach((citation) => {
              lines.push(`- ${citation}`);
            });
            lines.push('');
          }
        });

        if (section.subsections && section.subsections.length > 0) {
          appendSections(section.subsections, Math.min(depth + 1, 6));
        }
      });
    };

    if (run?.sections) {
      appendSections(run.sections, 2);
    }

    return lines.join('\n');
  }, [run?.documentTitle, run?.templateName, run?.sections]);

  const convertMarkdownToDocx = useCallback((markdown: string) => {
    type DocxChild = Paragraph | Table;
    const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as any;

    const numbering = {
      config: [
        {
          reference: 'docgen-numbering',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    };

    const renderInline = (node: any, marks: { bold?: boolean; italics?: boolean; code?: boolean } = {}): TextRun[] => {
      switch (node.type) {
        case 'text':
          return [new TextRun({ text: node.value || '', bold: marks.bold, italics: marks.italics })];
        case 'strong':
          return (node.children || []).flatMap((child: any) =>
            renderInline(child, { ...marks, bold: true })
          );
        case 'emphasis':
          return (node.children || []).flatMap((child: any) =>
            renderInline(child, { ...marks, italics: true })
          );
        case 'inlineCode':
          return [
            new TextRun({
              text: node.value || '',
              bold: marks.bold,
              italics: marks.italics,
              font: 'Consolas',
            }),
          ];
        case 'link':
          return (node.children || []).flatMap((child: any) =>
            renderInline(child, { ...marks }).map((run) =>
              new TextRun({
                text: (run as any).text || '',
                bold: marks.bold,
                italics: marks.italics,
                color: '2A5DB0',
                underline: {},
              })
            )
          );
        case 'break':
          return [new TextRun({ text: '', break: 1 })];
        default:
          return (node.children || []).flatMap((child: any) => renderInline(child, marks));
      }
    };

    const paragraphFromChildren = (
      children: any[],
      options?: { heading?: HeadingLevel; bullet?: { level: number }; numbering?: { level: number; reference: string }; forceBold?: boolean }
    ) => {
      const runs = (children || []).flatMap((child) => renderInline(child, options?.forceBold ? { bold: true } : {}));
      return new Paragraph({
        children: runs.length > 0 ? runs : [new TextRun('')],
        heading: options?.heading,
        bullet: options?.bullet,
        numbering: options?.numbering,
        spacing: { after: 160 },
      });
    };

    const renderList = (node: any, level: number): Paragraph[] => {
      const isOrdered = Boolean(node.ordered);
      const listParagraphs: Paragraph[] = [];

      (node.children || []).forEach((item: any) => {
        (item.children || []).forEach((child: any) => {
          if (child.type === 'paragraph') {
            listParagraphs.push(
              paragraphFromChildren(child.children || [], {
                bullet: isOrdered ? undefined : { level },
                numbering: isOrdered ? { level, reference: 'docgen-numbering' } : undefined,
              })
            );
          } else if (child.type === 'list') {
            listParagraphs.push(...renderList(child, Math.min(level + 1, 8)));
          } else {
            listParagraphs.push(paragraphFromChildren(child.children || [], {
              bullet: isOrdered ? undefined : { level },
              numbering: isOrdered ? { level, reference: 'docgen-numbering' } : undefined,
            }));
          }
        });
      });

      return listParagraphs;
    };

    const renderTable = (node: any): Table => {
      const rows = (node.children || []).map((row: any, rowIndex: number) => {
        const isHeader = rowIndex === 0;
        const cells = (row.children || []).map((cell: any) => {
          const cellParagraphs = (cell.children || []).flatMap((child: any) => {
            if (child.type === 'paragraph') {
              return [paragraphFromChildren(child.children || [], { forceBold: isHeader })];
            }
            return renderBlocks([child]);
          });
          return new TableCell({
            children: cellParagraphs.length > 0 ? cellParagraphs : [new Paragraph('')],
          });
        });
        return new TableRow({ children: cells, tableHeader: isHeader });
      });

      return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      });
    };

    const renderBlocks = (nodes: any[]): DocxChild[] => {
      const output: DocxChild[] = [];
      (nodes || []).forEach((node: any) => {
        switch (node.type) {
          case 'heading': {
            const levelMap: Record<number, HeadingLevel> = {
              1: HeadingLevel.HEADING_1,
              2: HeadingLevel.HEADING_2,
              3: HeadingLevel.HEADING_3,
              4: HeadingLevel.HEADING_4,
              5: HeadingLevel.HEADING_5,
              6: HeadingLevel.HEADING_6,
            };
            output.push(paragraphFromChildren(node.children || [], { heading: levelMap[node.depth] || HeadingLevel.HEADING_2 }));
            break;
          }
          case 'paragraph':
            output.push(paragraphFromChildren(node.children || []));
            break;
          case 'list':
            output.push(...renderList(node, 0));
            break;
          case 'blockquote':
            output.push(
              new Paragraph({
                children: (node.children || []).flatMap((child: any) => renderInline(child)),
                indent: { left: 720 },
                spacing: { after: 160 },
                italic: true,
              })
            );
            break;
          case 'code':
            output.push(
              new Paragraph({
                children: [new TextRun({ text: node.value || '', font: 'Consolas' })],
                spacing: { after: 160 },
              })
            );
            break;
          case 'table':
            output.push(renderTable(node));
            output.push(new Paragraph(''));
            break;
          case 'thematicBreak':
            output.push(new Paragraph(''));
            break;
          default:
            if (node.children) {
              output.push(...renderBlocks(node.children));
            }
        }
      });
      return output;
    };

    const children = renderBlocks(tree.children || []);

    return new DocxDocument({
      numbering,
      sections: [
        {
          properties: {},
          children: children.length > 0 ? children : [new Paragraph('')],
        },
      ],
    });
  }, []);

  const handleShare = useCallback(async () => {
    const title = run?.documentTitle || run?.templateName || 'Document';
    const url = window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        toast.success('Share sheet opened');
        return;
      }
    } catch (error) {
      // Fall back to clipboard if share sheet fails
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch (error) {
      toast.error('Could not copy link');
    }
  }, [run?.documentTitle, run?.templateName]);

  const handleExport = useCallback(async () => {
    if (!run?.sections || run.sections.length === 0) {
      toast.error('No document content to export');
      return;
    }

    const title = run.documentTitle || run.templateName || 'Document';
    const markdown = buildMarkdown();
    try {
      const doc = convertMarkdownToDocx(markdown);
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFilename(title)}.docx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Word export started');
    } catch (error) {
      toast.error('Failed to export Word document');
    }
  }, [buildMarkdown, convertMarkdownToDocx, run?.documentTitle, run?.templateName, run?.sections, sanitizeFilename]);

  const getRagSourceTooltip = useCallback((block: GeneratedBlock, citation: string) => {
    if (!block.ragSources || block.ragSources.length === 0) {
      return citation;
    }

    const match = block.ragSources.find((source) => citation.includes(source.filePath));
    if (!match) {
      return citation;
    }

    const lines = match.lineRange ? `${match.lineRange.start}-${match.lineRange.end}` : 'n/a';
    const excerpt = match.excerpt
      ? match.excerpt.replace(/\s+/g, ' ').slice(0, 260)
      : 'No excerpt available';
    const category = match.category ? ` (${match.category})` : '';
    const reason = match.reason ? `\nReason: ${match.reason}` : '';

    return `${match.filePath}:${lines}\nTier: ${match.tier}${category}${reason}\nExcerpt: ${excerpt}`;
  }, []);

  const renderEvidenceDetails = useCallback((block: GeneratedBlock) => {
    const hasRag = !!block.ragSources?.length;
    const hasData = !!block.dataEvidence?.length;
    if (!hasRag && !hasData) return null;

    return (
      <details className="mt-3">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
          View retrieval evidence
        </summary>
        <div className="mt-2 space-y-3 text-xs text-muted-foreground">
          {hasRag && (
            <div className="space-y-2">
              <div className="font-medium uppercase tracking-wide">RAG Sources</div>
              {block.ragSources?.slice(0, 6).map((source, idx) => (
                <div key={`${source.filePath}-${idx}`} className="rounded-md border border-glass-border/60 bg-secondary/50 dark:bg-secondary/30 p-2">
                  <div className="text-foreground font-medium">
                    {source.filePath}
                    {source.lineRange ? `:${source.lineRange.start}-${source.lineRange.end}` : ''}
                  </div>
                  <div className="text-foreground/80">Tier: {source.tier}{source.category ? ` (${source.category})` : ''}</div>
                  {source.excerpt && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {source.excerpt.length > 240 ? `${source.excerpt.slice(0, 240)}...` : source.excerpt}
                    </div>
                  )}
                </div>
              ))}
              {block.ragSources && block.ragSources.length > 6 && (
                <div className="text-[11px] text-muted-foreground">
                  +{block.ragSources.length - 6} more sources
                </div>
              )}
            </div>
          )}
          {hasData && (
            <div className="space-y-2">
              <div className="font-medium uppercase tracking-wide">Data Evidence</div>
              {block.dataEvidence?.map((data) => (
                <div key={data.filePath} className="rounded-md border border-glass-border/60 bg-secondary/50 dark:bg-secondary/30 p-2">
                  <div className="text-foreground font-medium">{data.filePath}</div>
                  <div className="text-foreground/80">{data.rowCount} rows, {data.columns.length} columns</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    );
  }, []);

  // Full height container - header is 64px (4rem)
  return (
    <div className="flex h-full overflow-hidden px-6 pt-6">
      {/* Document Outline Sidebar */}
      <div className={cn(
        "shrink-0 border-r border-glass-border bg-background/50 transition-all duration-300 flex flex-col",
        isOutlineCollapsed ? "w-0" : "w-52"
      )}>
        {!isOutlineCollapsed && (
          <>
            <div className="h-12 px-3 border-b border-glass-border flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Outline
              </h3>
              <button
                onClick={() => setIsOutlineCollapsed(true)}
                className="p-1 hover:bg-glass-bg rounded"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {run.sections.map((section, index) => (
                <div key={section.id}>
                  {/* Main section */}
                  <button
                    onClick={() => scrollToSection(section.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-1",
                      activeSection === section.id
                        ? "bg-brand-orange/10 text-brand-orange font-medium"
                        : "text-muted-foreground hover:bg-glass-bg hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-xs opacity-50">{index + 1}</span>
                      <span className="truncate text-xs">{section.title}</span>
                    </span>
                  </button>
                  {/* Subsections */}
                  {section.subsections?.map((subsection, subIndex) => (
                    <button
                      key={subsection.id}
                      onClick={() => scrollToSection(subsection.id)}
                      className={cn(
                        "w-full text-left pl-7 pr-3 py-1.5 rounded-lg text-xs transition-colors mb-0.5",
                        activeSection === subsection.id
                          ? "bg-brand-orange/10 text-brand-orange font-medium"
                          : "text-muted-foreground/70 hover:bg-glass-bg hover:text-foreground"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-xs opacity-40">{index + 1}.{subIndex + 1}</span>
                        <span className="truncate">{subsection.title}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </>
        )}
      </div>

      {/* Toggle Outline Button (when collapsed) */}
      {isOutlineCollapsed && (
        <button
          onClick={() => setIsOutlineCollapsed(false)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-secondary/50 dark:bg-secondary/30 border border-glass-border rounded-r-lg p-1 hover:bg-secondary/70 dark:hover:bg-secondary/50 transition-colors text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* Main Document Editor */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="shrink-0 border-b border-glass-border bg-background/50 px-4">
          <div className="h-12 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Link 
                href={`/projects/${projectId}`}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <div className="min-w-0">
                <h1 className="font-semibold truncate text-sm">{run.documentTitle || run.templateName}</h1>
                <p className="text-xs text-muted-foreground truncate">{project?.name}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              {gaps.length > 0 && (
                <button 
                  onClick={() => { setIsChatOpen(true); setChatTab('gaps'); }}
                  className="btn-ghost text-xs flex items-center gap-1 text-yellow-500"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {gaps.length} gap{gaps.length > 1 ? 's' : ''}
                </button>
              )}
              <button onClick={handleShare} className="btn-ghost text-xs">
                <Share className="h-4 w-4 mr-1" />
                Share
              </button>
              <button onClick={handleExport} className="btn-secondary text-xs py-1.5">
                <Download className="h-4 w-4 mr-1" />
                Export
              </button>
              <button 
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={cn(
                  "p-2 rounded-lg transition-colors",
                  isChatOpen ? "bg-brand-orange/10 text-brand-orange" : "hover:bg-glass-bg"
                )}
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Document Content */}
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="max-w-4xl mx-auto py-8 px-6 pb-20">
            {/* Document Container - White pane for light mode, glass for dark */}
            <div 
              ref={documentContainerRef}
              className={cn(
                "document-container relative transition-all duration-700 ease-out transform-gpu",
                "rounded-2xl shadow-2xl",
                // Light mode: white document paper
                "light:bg-white light:shadow-[0_20px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.05)]",
                "light:border light:border-gray-200/50",
                // Dark mode: enhanced glass
                "dark:bg-glass-bg dark:backdrop-blur-xl dark:border dark:border-glass-border",
                "dark:shadow-[0_20px_60px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]",
                // Smooth entrance animation
                "opacity-0 translate-y-8 animate-[fadeIn_0.8s_ease-out_0.2s_forwards]"
              )}
            >
              <div className={cn(
                "px-8 py-10 md:px-12 md:py-14",
                // Ensure white background in light mode
                "light:bg-white"
              )}>
            {run.sections.map((section) => {
              // Check if this section has a gap (either being fixed or just highlighted)
              const gapForSection = activeGap && (activeGap.sectionId === section.id || activeGap.sectionTitle === section.title) 
                ? activeGap 
                : highlightedGap && (highlightedGap.sectionId === section.id || highlightedGap.sectionTitle === section.title)
                ? highlightedGap
                : null;
              
              // Severity-based colors (critical/high = red, medium = yellow, low = blue)
              const severityStyles: Record<string, { ring: string; bg: string; text: string }> = {
                critical: { ring: 'ring-red-500/50', bg: 'bg-red-500/5', text: 'text-red-500' },
                high: { ring: 'ring-red-500/50', bg: 'bg-red-500/5', text: 'text-red-500' },
                medium: { ring: 'ring-yellow-500/50', bg: 'bg-yellow-500/5', text: 'text-yellow-500' },
                low: { ring: 'ring-blue-500/50', bg: 'bg-blue-500/5', text: 'text-blue-500' },
              };
              
              const gapStyle = gapForSection ? severityStyles[gapForSection.severity] : null;
              
              return (
              <div
                key={section.id}
                ref={(el) => { sectionRefs.current[section.id] = el; }}
                className={cn(
                  "mb-10 pb-6 transition-all duration-500 ease-out",
                  "opacity-0 translate-y-4 animate-[fadeIn_0.6s_ease-out_forwards]",
                  gapStyle && `ring-2 ${gapStyle.ring} ${gapStyle.bg} rounded-xl p-5`
                )}
                style={{ animationDelay: `${section.id.charCodeAt(0) % 5 * 0.1}s` }}
              >
                {/* Section Title */}
                <h2 className={cn(
                  "text-2xl font-bold mb-4 pb-3 border-b transition-colors duration-300",
                  "text-foreground",
                  "light:border-gray-200 light:text-gray-900",
                  "dark:border-glass-border dark:text-foreground"
                )}>
                  {section.title}
                </h2>
                
                {/* Gap indicator banner */}
                {gapForSection && (
                  <div className={cn("flex items-center gap-2 mb-4 text-sm", gapStyle?.text)}>
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">Gap: {gapForSection.description}</span>
                  </div>
                )}
                {/* Render subsections if they exist */}
                {section.subsections && section.subsections.length > 0 ? (
                  section.subsections.map((subsection) => {
                    const gapForSubsection = activeGap && (activeGap.sectionId === subsection.id || activeGap.sectionTitle === subsection.title) 
                      ? activeGap 
                      : highlightedGap && (highlightedGap.sectionId === subsection.id || highlightedGap.sectionTitle === subsection.title)
                      ? highlightedGap
                      : null;
                    const subsectionGapStyle = gapForSubsection ? severityStyles[gapForSubsection.severity] : null;
                    
                    return (
                      <div
                        key={subsection.id}
                        ref={(el) => { sectionRefs.current[subsection.id] = el; }}
                        className={cn(
                          "mb-8 pb-4 transition-all duration-300",
                          subsectionGapStyle && `ring-2 ${subsectionGapStyle.ring} ${subsectionGapStyle.bg} rounded-xl p-4`
                        )}
                      >
                        {/* Subsection Title */}
                        <h3 className="text-xl font-semibold text-foreground mb-3 pb-2 border-b border-glass-border/50">
                          {subsection.title}
                        </h3>
                        
                        {/* Gap indicator for subsection */}
                        {gapForSubsection && (
                          <div className={cn("flex items-center gap-2 mb-3 text-sm", subsectionGapStyle?.text)}>
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span className="font-medium text-xs">Gap: {gapForSubsection.description}</span>
                          </div>
                        )}
                        
                        {/* Subsection blocks */}
                        {subsection.blocks.map((block) => (
                          <div key={block.id} className="group">
                            {/* Block rendering - same as main section blocks */}
                            {editingBlock === block.id ? (
                              <BlockEditor
                                block={block}
                                sectionId={subsection.id}
                                onSave={(content) => saveBlockEdit(subsection.id, block.id, content)}
                                onCancel={() => setEditingBlock(null)}
                              />
                            ) : (
                              <>
                                {/* Block Actions Toolbar */}
                                <div className={cn(
                                  "flex items-center justify-end gap-1 mb-2 transition-opacity",
                                  "opacity-0 group-hover:opacity-100"
                                )}>
                                  <span className={cn(
                                    "text-xs px-2 py-0.5 rounded-full",
                                    block.confidence >= 0.85 ? "bg-green-500/20 text-green-400" :
                                    block.confidence >= 0.7 ? "bg-yellow-500/20 text-yellow-400" :
                                    "bg-red-500/20 text-red-400"
                                  )}>
                                    {Math.round(block.confidence * 100)}%
                                  </span>
                                  <button
                                    onClick={() => setEditingBlock(block.id)}
                                    className="p-1.5 rounded-lg bg-secondary/50 dark:bg-secondary/30 hover:bg-secondary/70 dark:hover:bg-secondary/50 text-foreground transition-colors border border-glass-border"
                                    title="Edit"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setAiPromptBlock(block.id)}
                                    className="p-1.5 rounded-lg bg-secondary/50 dark:bg-secondary/30 hover:bg-brand-orange/20 text-foreground hover:text-brand-orange transition-colors border border-glass-border"
                                    title="Enhance with AI"
                                  >
                                    {regeneratingBlock === block.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Sparkles className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                                
                                {/* Block Content */}
                                <div className={cn(
                                  "prose prose-sm max-w-none transition-colors duration-300",
                                  "prose-headings:text-foreground prose-p:text-foreground/90",
                                  "prose-strong:text-foreground prose-a:text-brand-orange",
                                  "light:prose-headings:text-gray-900 light:prose-p:text-gray-800",
                                  "light:prose-strong:text-gray-900 light:prose-code:text-gray-800",
                                  "light:bg-white",
                                  "dark:prose-invert dark:bg-transparent"
                                )}>
                                  <ReactMarkdown 
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      h1: ({ children }) => <h1 className={cn("text-xl font-bold mt-4 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h1>,
                                      h2: ({ children }) => <h2 className={cn("text-lg font-semibold mt-3 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h2>,
                                      h3: ({ children }) => <h3 className={cn("text-base font-semibold mt-3 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h3>,
                                      p: ({ children }) => <p className={cn("my-2 leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</p>,
                                      ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
                                      ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
                                      li: ({ children }) => <li className={cn("leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</li>,
                                      strong: ({ children }) => <strong className={cn("font-semibold", "light:text-gray-900 dark:text-foreground")}>{children}</strong>,
                                      em: ({ children }) => <em className={cn("italic", "light:text-gray-800 dark:text-foreground/90")}>{children}</em>,
                                      code: ({ children, className }) => {
                                        const isInline = !className;
                                        return isInline ? (
                                          <code className={cn("bg-glass-bg px-1.5 py-0.5 rounded text-brand-orange text-xs", "light:bg-gray-100 light:text-brand-orange")}>{children}</code>
                                        ) : (
                                          <code className={cn("block bg-glass-bg p-3 rounded-lg overflow-x-auto text-xs", "light:bg-gray-100 light:text-gray-900 dark:text-foreground")}>{children}</code>
                                        );
                                      },
                                      pre: ({ children }) => <pre className={cn("bg-glass-bg rounded-lg overflow-x-auto my-3", "light:bg-gray-100")}>{children}</pre>,
                                      blockquote: ({ children }) => (
                                        <blockquote className={cn("border-l-4 border-brand-orange pl-3 my-3 italic text-sm", "light:text-gray-700 dark:text-muted-foreground")}>
                                          {children}
                                        </blockquote>
                                      ),
                                      table: ({ children }) => (
                                        <div className="overflow-x-auto my-3">
                                          <table className="w-full border-collapse text-sm">{children}</table>
                                        </div>
                                      ),
                                      th: ({ children }) => (
                                        <th className={cn("border border-glass-border bg-glass-bg px-3 py-2 text-left font-medium text-xs", "light:text-gray-900 dark:text-foreground")}>{children}</th>
                                      ),
                                      td: ({ children }) => (
                                        <td className={cn("border border-glass-border px-3 py-2 text-xs", "light:text-gray-800 dark:text-foreground/90")}>{children}</td>
                                      ),
                                    }}
                                  >
                                    {block.content}
                                  </ReactMarkdown>
                                </div>
                                
                                {/* Citations for subsection blocks */}
                                {block.citations && block.citations.length > 0 && (
                                  <div className="mt-6 mb-8 pt-4 pb-3 border-t border-dashed border-glass-border/50">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sources:</span>
                                      {block.citations.slice(0, 5).map((citation, i) => (
                                        <span
                                          key={i}
                                          className="text-xs px-2 py-1 rounded bg-glass-bg border border-glass-border text-muted-foreground hover:text-foreground dark:text-foreground/80 dark:hover:text-foreground transition-colors cursor-pointer"
                                          title={getRagSourceTooltip(block, citation)}
                                        >
                                          {citation.split('/').pop() || citation}
                                        </span>
                                      ))}
                                    </div>
                                    {renderEvidenceDetails(block)}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })
                ) : (
                  /* Main section blocks (when no subsections) */
                  section.blocks.map((block) => (
                  <div key={block.id} className="group">
                    {/* Editing Mode */}
                    {editingBlock === block.id ? (
                      <BlockEditor
                        block={block}
                        sectionId={section.id}
                        onSave={(content) => saveBlockEdit(section.id, block.id, content)}
                        onCancel={() => setEditingBlock(null)}
                      />
                    ) : (
                      <>
                        {/* Block Actions Toolbar - ABOVE the content */}
                        <div className={cn(
                          "flex items-center justify-end gap-1 mb-2 transition-opacity",
                          "opacity-0 group-hover:opacity-100"
                        )}>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            block.confidence >= 0.85 ? "bg-green-500/20 text-green-400" :
                            block.confidence >= 0.7 ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-red-500/20 text-red-400"
                          )}>
                            {Math.round(block.confidence * 100)}%
                          </span>
                          <button
                            onClick={() => setEditingBlock(block.id)}
                            className="p-1.5 rounded-lg bg-glass-bg hover:bg-glass-bg-light text-muted-foreground hover:text-foreground transition-colors border border-glass-border"
                            title="Edit"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setAiPromptBlock(block.id)}
                            className="p-1.5 rounded-lg bg-glass-bg hover:bg-brand-orange/20 text-muted-foreground hover:text-brand-orange transition-colors border border-glass-border"
                            title="Enhance with AI"
                          >
                            {regeneratingBlock === block.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        {/* AI Prompt Input */}
                        {aiPromptBlock === block.id && (
                          <div className="mb-4 bg-glass-bg border border-glass-border rounded-xl p-3 shadow-lg">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-brand-orange shrink-0" />
                              <input
                                type="text"
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAiEnhance(section.id, block.id);
                                  if (e.key === 'Escape') setAiPromptBlock(null);
                                }}
                                placeholder="How should I enhance this section?"
                                className="flex-1 bg-transparent border-none outline-none text-sm"
                                autoFocus
                              />
                              <button
                                onClick={() => handleAiEnhance(section.id, block.id)}
                                className="btn-primary text-xs py-1 px-3"
                              >
                                Enhance
                              </button>
                              <button
                                onClick={() => setAiPromptBlock(null)}
                                className="p-1 hover:bg-glass-bg-light rounded"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Block Content with Inline Charts */}
                        <div className={cn(
                          "prose prose-sm max-w-none transition-colors duration-300",
                          "prose-headings:text-foreground prose-p:text-foreground/90",
                          "prose-strong:text-foreground prose-a:text-brand-orange",
                          "light:prose-headings:text-gray-900 light:prose-p:text-gray-800",
                          "light:prose-strong:text-gray-900 light:prose-code:text-gray-800",
                          "light:bg-white",
                          "dark:prose-invert dark:bg-transparent"
                        )}>
                          {(() => {
                            // Parse content for inline chart markers
                            const charts = block.generatedImages && block.generatedImages.length > 0 
                              ? block.generatedImages 
                              : block.generatedImage 
                                ? [block.generatedImage] 
                                : [];
                            
                            // Split executed code by chart if we have multiple charts
                            // Format: "# Chart 1: description\ncode\n\n# ---\n\n# Chart 2: description\ncode"
                            const chartCodes = block.executedCode 
                              ? block.executedCode.split(/\n\n# ---\n\n/).map(code => {
                                  // Remove the "# Chart N: description" header if present
                                  return code.replace(/^# Chart \d+: .+\n/, '').trim();
                                }).filter(Boolean)
                              : [];
                            
                            // Check if content has chart markers
                            const chartMarkerRegex = /<!--CHART_START:(\d+):([^>]+)-->/g;
                            const hasInlineCharts = chartMarkerRegex.test(block.content);

                            // If no charts, just render content
                            if (charts.length === 0) {
                              return (
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    h1: ({ children }) => <h1 className={cn("text-2xl font-bold mt-6 mb-3 first:mt-0", "light:text-gray-900 dark:text-foreground")}>{children}</h1>,
                                    h2: ({ children }) => <h2 className={cn("text-xl font-bold mt-5 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h2>,
                                    h3: ({ children }) => <h3 className={cn("text-lg font-semibold mt-4 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h3>,
                                    p: ({ children }) => <p className={cn("my-2 leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</p>,
                                    ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
                                    ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
                                    li: ({ children }) => <li className={cn("leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</li>,
                                    strong: ({ children }) => <strong className={cn("font-semibold", "light:text-gray-900 dark:text-foreground")}>{children}</strong>,
                                    em: ({ children }) => <em className={cn("italic", "light:text-gray-800 dark:text-foreground/90")}>{children}</em>,
                                    code: ({ children, className }) => {
                                      const isInline = !className;
                                      return isInline ? (
                                        <code className={cn("bg-glass-bg px-1.5 py-0.5 rounded text-brand-orange text-xs", "light:bg-gray-100 light:text-brand-orange")}>{children}</code>
                                      ) : (
                                        <code className={cn("block bg-glass-bg p-3 rounded-lg overflow-x-auto text-xs", "light:bg-gray-100 light:text-gray-900 dark:text-foreground")}>{children}</code>
                                      );
                                    },
                                    pre: ({ children }) => <pre className={cn("bg-glass-bg rounded-lg overflow-x-auto my-3", "light:bg-gray-100")}>{children}</pre>,
                                    blockquote: ({ children }) => (
                                      <blockquote className={cn("border-l-4 border-brand-orange pl-3 my-3 italic text-sm", "light:text-gray-700 dark:text-muted-foreground")}>
                                        {children}
                                      </blockquote>
                                    ),
                                    table: ({ children }) => (
                                      <div className="overflow-x-auto my-3">
                                        <table className="w-full border-collapse text-sm">{children}</table>
                                      </div>
                                    ),
                                    th: ({ children }) => (
                                      <th className={cn("border border-glass-border bg-glass-bg px-3 py-2 text-left font-medium text-xs", "light:text-gray-900 dark:text-foreground")}>{children}</th>
                                    ),
                                    td: ({ children }) => (
                                      <td className={cn("border border-glass-border px-3 py-2 text-xs", "light:text-gray-800 dark:text-foreground/90")}>{children}</td>
                                    ),
                                  }}
                                >
                                  {block.content}
                                </ReactMarkdown>
                              );
                            }

                            // If no inline markers but we have charts, render charts inline at the top
                            if (!hasInlineCharts) {
                              return (
                                <>
                                  {/* Render all charts first */}
                                  {charts.map((chart, idx) => (
                                    <div key={idx} className="mb-6 p-4 bg-glass-bg rounded-lg border border-glass-border">
                                      <div className="flex items-center gap-2 mb-3">
                                        <BarChart3 className="h-4 w-4 text-brand-orange" />
                                        <span className="text-sm font-medium">
                                          {chart.description || (charts.length > 1 ? `Chart ${idx + 1}` : 'Generated Chart')}
                                        </span>
                                      </div>
                                      <div className="relative w-full" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                                        <img
                                          src={`data:${chart.mimeType};base64,${chart.base64}`}
                                          alt={`Chart ${idx + 1}: ${chart.description || block.title}`}
                                          className="w-full h-auto rounded-lg border border-glass-border/50"
                                          style={{ maxWidth: '100%', display: 'block' }}
                                        />
                                      </div>
                                      {(chartCodes[idx] || (idx === 0 && block.executedCode)) && (
                                        <details className="mt-3">
                                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                                            <span>📊</span>
                                            <span>View Python code and analysis data</span>
                                          </summary>
                                          <pre className="mt-2 p-3 bg-background rounded-lg text-xs overflow-x-auto max-h-96 custom-scrollbar">
                                            <code>{chartCodes[idx] || block.executedCode}</code>
                                          </pre>
                                        </details>
                                      )}
                                    </div>
                                  ))}

                                  {/* Then render content if any */}
                                  {block.content && block.content.trim() && (
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        h1: ({ children }) => <h1 className={cn("text-2xl font-bold mt-6 mb-3 first:mt-0", "light:text-gray-900 dark:text-foreground")}>{children}</h1>,
                                        h2: ({ children }) => <h2 className={cn("text-xl font-bold mt-5 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h2>,
                                        h3: ({ children }) => <h3 className={cn("text-lg font-semibold mt-4 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h3>,
                                        p: ({ children }) => <p className={cn("my-2 leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</p>,
                                        ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
                                        ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
                                        li: ({ children }) => <li className={cn("leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</li>,
                                        strong: ({ children }) => <strong className={cn("font-semibold", "light:text-gray-900 dark:text-foreground")}>{children}</strong>,
                                        em: ({ children }) => <em className={cn("italic", "light:text-gray-800 dark:text-foreground/90")}>{children}</em>,
                                        code: ({ children, className }) => {
                                          const isInline = !className;
                                          return isInline ? (
                                            <code className={cn("bg-glass-bg px-1.5 py-0.5 rounded text-brand-orange text-xs", "light:bg-gray-100 light:text-brand-orange")}>{children}</code>
                                          ) : (
                                            <code className={cn("block bg-glass-bg p-3 rounded-lg overflow-x-auto text-xs", "light:bg-gray-100 light:text-gray-900 dark:text-foreground")}>{children}</code>
                                          );
                                        },
                                        pre: ({ children }) => <pre className={cn("bg-glass-bg rounded-lg overflow-x-auto my-3", "light:bg-gray-100")}>{children}</pre>,
                                        blockquote: ({ children }) => (
                                          <blockquote className={cn("border-l-4 border-brand-orange pl-3 my-3 italic text-sm", "light:text-gray-700 dark:text-muted-foreground")}>
                                            {children}
                                          </blockquote>
                                        ),
                                        table: ({ children }) => (
                                          <details className="my-3 p-3 bg-glass-bg rounded-lg border border-glass-border">
                                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1 mb-2">
                                              <span>📋</span>
                                              <span>View Data Table</span>
                                            </summary>
                                            <div className="overflow-x-auto mt-2">
                                              <table className="w-full border-collapse text-sm">{children}</table>
                                            </div>
                                          </details>
                                        ),
                                        th: ({ children }) => (
                                          <th className={cn("border border-glass-border bg-glass-bg px-3 py-2 text-left font-medium text-xs", "light:text-gray-900 dark:text-foreground")}>{children}</th>
                                        ),
                                        td: ({ children }) => (
                                          <td className={cn("border border-glass-border px-3 py-2 text-xs", "light:text-gray-800 dark:text-foreground/90")}>{children}</td>
                                        ),
                                      }}
                                    >
                                      {block.content}
                                    </ReactMarkdown>
                                  )}
                                </>
                              );
                            }
                            
                            // Parse content with inline chart markers
                            const parts: Array<{ type: 'text' | 'chart'; content?: string; chartIndex?: number }> = [];
                            let lastIndex = 0;
                            chartMarkerRegex.lastIndex = 0; // Reset regex
                            
                            let match;
                            while ((match = chartMarkerRegex.exec(block.content)) !== null) {
                              // Add text before chart
                              if (match.index > lastIndex) {
                                parts.push({
                                  type: 'text',
                                  content: block.content.substring(lastIndex, match.index),
                                });
                              }
                              
                              // Add chart marker
                              const chartIndex = parseInt(match[1], 10);
                              parts.push({
                                type: 'chart',
                                chartIndex,
                              });
                              
                              lastIndex = match.index + match[0].length;
                            }
                            
                            // Add remaining text
                            if (lastIndex < block.content.length) {
                              parts.push({
                                type: 'text',
                                content: block.content.substring(lastIndex),
                              });
                            }
                            
                            // Render parts
                            return parts.map((part, partIdx) => {
                              if (part.type === 'text') {
                                return (
                                  <ReactMarkdown 
                                    key={partIdx}
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      h1: ({ children }) => <h1 className={cn("text-2xl font-bold mt-6 mb-3 first:mt-0", "light:text-gray-900 dark:text-foreground")}>{children}</h1>,
                                      h2: ({ children }) => <h2 className={cn("text-xl font-bold mt-5 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h2>,
                                      h3: ({ children }) => <h3 className={cn("text-lg font-semibold mt-4 mb-2", "light:text-gray-900 dark:text-foreground")}>{children}</h3>,
                                      p: ({ children }) => <p className={cn("my-2 leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</p>,
                                      ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
                                      ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
                                      li: ({ children }) => <li className={cn("leading-relaxed text-sm", "light:text-gray-800 dark:text-foreground/90")}>{children}</li>,
                                      strong: ({ children }) => <strong className={cn("font-semibold", "light:text-gray-900 dark:text-foreground")}>{children}</strong>,
                                      em: ({ children }) => <em className={cn("italic", "light:text-gray-800 dark:text-foreground/90")}>{children}</em>,
                                      code: ({ children, className }) => {
                                        const isInline = !className;
                                        return isInline ? (
                                          <code className={cn("bg-glass-bg px-1.5 py-0.5 rounded text-brand-orange text-xs", "light:bg-gray-100 light:text-brand-orange")}>{children}</code>
                                        ) : (
                                          <code className={cn("block bg-glass-bg p-3 rounded-lg overflow-x-auto text-xs", "light:bg-gray-100 light:text-gray-900 dark:text-foreground")}>{children}</code>
                                        );
                                      },
                                      pre: ({ children }) => <pre className={cn("bg-glass-bg rounded-lg overflow-x-auto my-3", "light:bg-gray-100")}>{children}</pre>,
                                      blockquote: ({ children }) => (
                                        <blockquote className={cn("border-l-4 border-brand-orange pl-3 my-3 italic text-sm", "light:text-gray-700 dark:text-muted-foreground")}>
                                          {children}
                                        </blockquote>
                                      ),
                                      table: ({ children }) => (
                                        <div className="overflow-x-auto my-3">
                                          <table className="w-full border-collapse text-sm">{children}</table>
                                        </div>
                                      ),
                                      th: ({ children }) => (
                                        <th className={cn("border border-glass-border bg-glass-bg px-3 py-2 text-left font-medium text-xs", "light:text-gray-900 dark:text-foreground")}>{children}</th>
                                      ),
                                      td: ({ children }) => (
                                        <td className={cn("border border-glass-border px-3 py-2 text-xs", "light:text-gray-800 dark:text-foreground/90")}>{children}</td>
                                      ),
                                    }}
                                  >
                                    {part.content || ''}
                                  </ReactMarkdown>
                                );
                              } else {
                                // Render chart inline
                                const chart = charts[part.chartIndex!];
                                if (!chart) return null;
                                
                                const chartCode = chartCodes[part.chartIndex!] || (part.chartIndex === 0 && block.executedCode ? block.executedCode : undefined);
                                
                                return (
                                  <div key={partIdx} className="my-4 p-4 bg-glass-bg rounded-lg border border-glass-border">
                                    <div className="flex items-center gap-2 mb-3">
                                      <BarChart3 className="h-4 w-4 text-brand-orange" />
                                      <span className="text-sm font-medium">
                                        {chart.description || `Chart ${part.chartIndex! + 1}`}
                                      </span>
                                    </div>
                                    <img
                                      src={`data:${chart.mimeType};base64,${chart.base64}`}
                                      alt={`Chart ${part.chartIndex! + 1}: ${chart.description || block.title}`}
                                      className="max-w-full rounded-lg border border-glass-border/50"
                                    />
                                    {chartCode && (
                                      <details className="mt-3">
                                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                          View Python code and analysis data
                                        </summary>
                                        <pre className="mt-2 p-3 bg-background rounded-lg text-xs overflow-x-auto">
                                          <code>{chartCode}</code>
                                        </pre>
                                      </details>
                                    )}
                                  </div>
                                );
                              }
                            });
                          })()}
                        </div>
                        
                        {/* Citations - with proper spacing */}
                        {block.citations && block.citations.length > 0 && (
                          <div className="mt-6 mb-8 pt-4 pb-3 border-t border-dashed border-glass-border/50">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sources:</span>
                              {block.citations.slice(0, 5).map((citation, i) => (
                                <span
                                  key={i}
                                  className="text-xs bg-secondary/50 dark:bg-secondary/30 px-2 py-1 rounded-md text-foreground/90 hover:text-brand-orange hover:bg-brand-orange/10 dark:hover:bg-brand-orange/20 cursor-pointer transition-colors border border-glass-border/50"
                                  title={getRagSourceTooltip(block, citation)}
                                >
                                  <Code className="h-3 w-3 inline mr-1" />
                                  {citation.length > 30 ? '...' + citation.slice(-25) : citation}
                                </span>
                              ))}
                              {block.citations.length > 5 && (
                                <span className="text-xs text-muted-foreground">
                                  +{block.citations.length - 5} more
                                </span>
                              )}
                            </div>
                            {renderEvidenceDetails(block)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
                )}
              </div>
            );})}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Chat & Gaps Panel */}
      <div className={cn(
        "shrink-0 border-l border-glass-border bg-background/50 transition-all duration-300 flex flex-col h-full overflow-hidden",
        isChatOpen ? "w-72" : "w-0"
      )}>
        {isChatOpen && (
          <div className="flex flex-col h-full w-72 overflow-hidden">
            {/* Tabs */}
            <div className="shrink-0 flex border-b border-glass-border h-12 items-center">
              <button
                onClick={() => setChatTab('chat')}
                className={cn(
                  "flex-1 h-12 text-xs font-medium transition-colors flex items-center justify-center",
                  chatTab === 'chat' 
                    ? "text-brand-orange border-b-2 border-brand-orange" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 inline mr-1" />
                Chat
              </button>
              <button
                onClick={() => setChatTab('gaps')}
                className={cn(
                  "flex-1 h-12 text-xs font-medium transition-colors relative flex items-center justify-center",
                  chatTab === 'gaps' 
                    ? "text-brand-orange border-b-2 border-brand-orange" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                Gaps
                {gaps.length > 0 && (
                  <span className="ml-1 bg-yellow-500 text-black text-xs px-1.5 py-0.5 rounded-full">
                    {gaps.length}
                  </span>
                )}
              </button>
            </div>
            
            {/* Panel Content */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {chatTab === 'chat' ? (
                <div className="p-3 space-y-3 pb-4">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "rounded-lg p-2.5 text-xs",
                        msg.role === 'assistant' 
                          ? "bg-glass-bg" 
                          : "bg-brand-orange/10 ml-4"
                      )}
                    >
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="my-1">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          ol: ({ children }) => <ol className="list-decimal ml-4 my-1">{children}</ol>,
                          li: ({ children }) => <li className="my-0.5">{children}</li>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  {/* Evidence Quality Metrics */}
                  {run?.qualityMetrics && (
                    <div className="glass-panel p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <BarChart3 className="h-3.5 w-3.5" />
                        Evidence Quality
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Tier-1 Citations</span>
                          <span className={cn(
                            "font-medium",
                            run.qualityMetrics.tier1CitationPercent >= 50 ? "text-green-500" :
                            run.qualityMetrics.tier1CitationPercent >= 25 ? "text-yellow-500" :
                            "text-red-500"
                          )}>
                            {run.qualityMetrics.tier1CitationPercent}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Section Coverage</span>
                          <span className={cn(
                            "font-medium",
                            run.qualityMetrics.tier1SectionCoverage >= 80 ? "text-green-500" :
                            run.qualityMetrics.tier1SectionCoverage >= 50 ? "text-yellow-500" :
                            "text-red-500"
                          )}>
                            {run.qualityMetrics.tier1SectionCoverage}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Data Audits</span>
                          <span className="font-medium text-foreground">
                            {run.qualityMetrics.executedValidationsCount}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Uncovered</span>
                          <span className={cn(
                            "font-medium",
                            run.qualityMetrics.uncoveredSectionsCount === 0 ? "text-green-500" :
                            "text-yellow-500"
                          )}>
                            {run.qualityMetrics.uncoveredSectionsCount}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1 border-t border-glass-border">
                        <span>Tier-1: {run.qualityMetrics.tier1Citations} code</span>
                        <span>•</span>
                        <span>Tier-2: {run.qualityMetrics.tier2Citations} docs</span>
                      </div>
                    </div>
                  )}
                  
                  {gaps.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Check className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      <p className="text-sm">No gaps detected!</p>
                      <p className="text-xs mt-1">Your documentation looks complete.</p>
                    </div>
                  ) : (
                    <>
                      {/* Debug: Show gap count */}
                      {process.env.NODE_ENV === 'development' && (
                        <div className="text-xs text-muted-foreground mb-2 px-2">
                          Showing {sortedGaps.length} of {gaps.length} gaps
                        </div>
                      )}
                      {sortedGaps.map((gap) => (
                        <GapCard 
                          key={gap.id} 
                          gap={gap} 
                          onFix={handleFixGap}
                          onHighlight={handleGapHighlight}
                          isActive={activeGap?.id === gap.id || highlightedGap?.id === gap.id}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            
            {/* Chat Input */}
            {chatTab === 'chat' && (
              <div className="shrink-0 border-t border-glass-border">
                {/* Active gap indicator */}
                {activeGap && (
                  <div className="px-3 py-2 bg-brand-orange/10 border-b border-glass-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-brand-orange font-medium">
                        Fixing: {activeGap.sectionTitle}
                      </span>
                      <button
                        onClick={() => {
                          setActiveGap(null);
                          setHighlightedGap(null);
                          setGapUploadedFiles([]);
                          setGapUserInfo('');
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                    {gapUploadedFiles.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {gapUploadedFiles.map((f, i) => (
                          <span key={i} className="text-xs bg-glass-bg px-1.5 py-0.5 rounded">
                            📎 {f.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Chat input */}
                <div className="p-3">
                  <div className="flex gap-2">
                    {/* File upload button (only in gap fixing mode) */}
                    {activeGap && (
                      <>
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleGapFileUpload}
                          multiple
                          accept=".txt,.md,.json,.csv,.py,.js,.ts,.yaml,.yml,.xml"
                          className="hidden"
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 bg-glass-bg border border-glass-border rounded-lg hover:border-brand-orange/50 transition-colors"
                          title="Upload file"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleChatSend()}
                      placeholder={activeGap ? "Provide info or say 'fix it'..." : "Ask anything..."}
                      disabled={isAnalyzingGap || isFixingGap}
                      className="flex-1 bg-glass-bg border border-glass-border rounded-lg px-3 py-2 text-xs focus:border-brand-orange focus:outline-none disabled:opacity-50"
                    />
                    <button 
                      onClick={handleChatSend} 
                      disabled={isAnalyzingGap || isFixingGap}
                      className="btn-primary p-2 disabled:opacity-50"
                    >
                      {isAnalyzingGap || isFixingGap ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  
                  {/* Quick action for gap fixing */}
                  {activeGap && !isAnalyzingGap && !isFixingGap && (
                    <button
                      onClick={applyGapFix}
                      className="w-full mt-2 py-1.5 text-xs text-brand-orange hover:bg-brand-orange/10 rounded-lg transition-colors"
                    >
                      ✨ Apply fix with current info
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
