import Link from 'next/link';
import { ArrowRight, FileText, GitBranch, Sparkles, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="relative z-10 flex min-h-screen flex-col">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-panel border-x-0 border-t-0 rounded-none">
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-orange">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-semibold">DocGen.AI</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="btn-ghost">
              Sign In
            </Link>
            <Link href="/login" className="btn-primary">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex flex-1 items-center justify-center px-6 pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass-bg px-4 py-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-brand-orange" />
            AI-Powered Documentation
          </div>
          
          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl">
            <span className="text-gradient">Generate Professional</span>
            <br />
            <span className="text-gradient-orange">Documentation</span>
            <br />
            <span className="text-gradient">From Your Code</span>
          </h1>
          
          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground md:text-xl">
            DocGen.AI understands your codebase like a senior engineer. 
            Connect your repo, choose a template, and let AI generate 
            comprehensive documentation with citations.
          </p>
          
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/login" className="btn-primary px-8 py-3 text-base">
              Start Free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="#features" className="btn-secondary px-8 py-3 text-base">
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 py-24">
        <div className="container mx-auto px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">
              Everything You Need
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              From model documentation to validation reports, DocGen.AI handles 
              complex technical documentation with precision.
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature Cards */}
            <FeatureCard
              icon={<GitBranch className="h-6 w-6" />}
              title="Repository Understanding"
              description="Connects to GitHub and builds a knowledge graph of your code structure, imports, and relationships."
            />
            <FeatureCard
              icon={<FileText className="h-6 w-6" />}
              title="Smart Templates"
              description="Use pre-built templates or upload existing documents to auto-generate reusable template structures."
            />
            <FeatureCard
              icon={<Sparkles className="h-6 w-6" />}
              title="AI Generation"
              description="LLM-powered content generation with citations, grounded in your actual codebase."
            />
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="Python Sandbox"
              description="Run data analysis and generate charts directly from your artifacts with isolated code execution."
            />
            <FeatureCard
              icon={<FileText className="h-6 w-6" />}
              title="Rich Editor"
              description="Edit generated content with a powerful WYSIWYG editor. Regenerate individual blocks as needed."
            />
            <FeatureCard
              icon={<GitBranch className="h-6 w-6" />}
              title="Export Anywhere"
              description="Export to Markdown, DOCX, or PDF. Perfect for sharing with stakeholders or regulators."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-24">
        <div className="container mx-auto px-6">
          <div className="glass-card mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold">
              Ready to Transform Your Documentation?
            </h2>
            <p className="mb-8 text-muted-foreground">
              Join teams using DocGen.AI to create accurate, well-cited 
              technical documentation in minutes instead of days.
            </p>
            <Link href="/login" className="btn-primary px-8 py-3 text-base">
              Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-glass-border py-8">
        <div className="container mx-auto flex items-center justify-between px-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand-orange" />
            <span>DocGen.AI</span>
          </div>
          <p>© 2024 DocGen.AI. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="glass-card group transition-all duration-300 hover:border-brand-orange/30">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-glass-bg-light text-brand-orange transition-colors group-hover:bg-brand-orange group-hover:text-white">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

