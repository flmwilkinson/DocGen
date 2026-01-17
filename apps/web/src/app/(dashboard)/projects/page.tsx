'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  FolderKanban,
  GitBranch,
  Clock,
  MoreVertical,
  FileText,
  Trash2,
  Settings,
  Upload,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/lib/utils';
import { useProjectsStore, type Project } from '@/store/projects';

export default function ProjectsPage() {
  const router = useRouter();
  const projects = useProjectsStore((state) => state.projects);
  const deleteProject = useProjectsStore((state) => state.deleteProject);

  // Sort projects by updatedAt (most recent first)
  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleDeleteProject = (projectId: string) => {
    if (confirm('Are you sure you want to delete this project?')) {
      deleteProject(projectId);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your documentation projects
          </p>
        </div>
        <button
          onClick={() => router.push('/projects/new')}
          className="btn-primary"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </button>
      </div>

      {/* Projects Grid - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 pb-4">
          {sortedProjects.map((project) => (
            <ProjectCard 
              key={project.id} 
              project={project} 
              onDelete={() => handleDeleteProject(project.id)}
            />
          ))}

          {/* Empty state placeholder */}
          {sortedProjects.length === 0 && (
            <div className="glass-card col-span-full flex flex-col items-center justify-center py-12 text-center">
              <FolderKanban className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">No projects yet</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Create your first project to get started
              </p>
              <button
                onClick={() => router.push('/projects/new')}
                className="btn-primary"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const router = useRouter();
  
  return (
    <div className="glass-card group relative transition-all duration-200 hover:border-brand-orange/30">
      {/* Card Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-glass-bg-light">
            <FolderKanban className="h-5 w-5 text-brand-orange" />
          </div>
          <div>
            <Link
              href={`/projects/${project.id}`}
              className="font-medium hover:text-brand-orange"
            >
              {project.name}
            </Link>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(project.updatedAt)}
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="btn-ghost p-1 opacity-0 transition-opacity group-hover:opacity-100">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
        {project.description || 'No description'}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-glass-border pt-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {project.sourceType === 'github' && project.repoUrl && (
            <div className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              <span>{project.repoStatus === 'READY' ? 'Connected' : 'Indexing...'}</span>
            </div>
          )}
          {project.sourceType === 'upload' && (
            <div className="flex items-center gap-1">
              <Upload className="h-3 w-3" />
              <span>{project.artifactsCount} files</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span>{project.documentsCount} docs</span>
          </div>
        </div>

        <Link
          href={`/projects/${project.id}`}
          className="text-xs font-medium text-brand-orange hover:underline"
        >
          Open →
        </Link>
      </div>
    </div>
  );
}

