'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { X, FolderKanban, GitBranch, Upload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<'info' | 'source'>('info');
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    sourceType: '' as 'github' | 'upload' | '',
    repoUrl: '',
  });

  const handleCreate = async () => {
    setIsLoading(true);
    
    // TODO: Call API to create project
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    setIsLoading(false);
    onOpenChange(false);
    router.push('/projects/new-project-id'); // Replace with actual ID
  };

  const resetForm = () => {
    setStep('info');
    setFormData({
      name: '',
      description: '',
      sourceType: '',
      repoUrl: '',
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(open) => {
      onOpenChange(open);
      if (!open) resetForm();
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 dark:bg-black/40 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 glass-panel p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <Dialog.Title className="flex items-center gap-3 text-lg font-semibold">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/20">
              <FolderKanban className="h-5 w-5 text-brand-orange" />
            </div>
            Create New Project
          </Dialog.Title>
          
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {step === 'info' 
              ? 'Enter your project details to get started.'
              : 'Choose how to connect your codebase.'}
          </Dialog.Description>

          <Dialog.Close asChild>
            <button className="absolute right-4 top-4 btn-ghost p-1">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          {/* Step 1: Project Info */}
          {step === 'info' && (
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Project Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Documentation Project"
                  className="input-glass"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of what this project documents..."
                  rows={3}
                  className="input-glass resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Dialog.Close asChild>
                  <button className="btn-secondary">Cancel</button>
                </Dialog.Close>
                <button
                  onClick={() => setStep('source')}
                  disabled={!formData.name}
                  className="btn-primary"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Source Selection */}
          {step === 'source' && (
            <div className="mt-6 space-y-4">
              <div className="grid gap-3">
                <SourceOption
                  icon={<GitBranch className="h-5 w-5" />}
                  title="Connect GitHub Repository"
                  description="Clone from a public or private repo"
                  selected={formData.sourceType === 'github'}
                  onClick={() => setFormData({ ...formData, sourceType: 'github' })}
                />
                <SourceOption
                  icon={<Upload className="h-5 w-5" />}
                  title="Upload ZIP File"
                  description="Upload your codebase as a ZIP archive"
                  selected={formData.sourceType === 'upload'}
                  onClick={() => setFormData({ ...formData, sourceType: 'upload' })}
                />
              </div>

              {formData.sourceType === 'github' && (
                <div className="space-y-2 pt-2">
                  <label htmlFor="repoUrl" className="text-sm font-medium">
                    Repository URL
                  </label>
                  <input
                    id="repoUrl"
                    type="url"
                    value={formData.repoUrl}
                    onChange={(e) => setFormData({ ...formData, repoUrl: e.target.value })}
                    placeholder="https://github.com/owner/repo"
                    className="input-glass"
                  />
                </div>
              )}

              {formData.sourceType === 'upload' && (
                <div className="space-y-2 pt-2">
                  <label className="text-sm font-medium">Upload ZIP</label>
                  <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-glass-border p-8 transition-colors hover:border-brand-orange/50">
                    <div className="text-center">
                      <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-sm text-muted-foreground">
                        Drag & drop or click to upload
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Max file size: 100MB
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between gap-3 pt-4">
                <button
                  onClick={() => setStep('info')}
                  className="btn-secondary"
                >
                  Back
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={handleCreate}
                    disabled={!formData.sourceType || isLoading}
                    className="btn-primary"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Create Project'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SourceOption({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-4 rounded-lg border p-4 text-left transition-all',
        selected
          ? 'border-brand-orange bg-brand-orange/10 dark:bg-brand-orange/20 text-foreground'
          : 'border-glass-border hover:border-brand-grey/50 bg-secondary/50 dark:bg-secondary/30 hover:bg-secondary/70 dark:hover:bg-secondary/50 text-foreground'
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          selected ? 'bg-brand-orange text-white' : 'bg-secondary/50 dark:bg-secondary/30 text-foreground'
        )}
      >
        {icon}
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

