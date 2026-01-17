'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { FileText, Clock, Search } from 'lucide-react';
import { useProjectsStore } from '@/store/projects';
import { formatRelativeTime } from '@/lib/utils';

const statusColors = {
  PENDING: 'bg-yellow-500/20 text-yellow-400',
  RUNNING: 'bg-blue-500/20 text-blue-400',
  COMPLETED: 'bg-green-500/20 text-green-400',
  FAILED: 'bg-red-500/20 text-red-400',
};

const statusLabels = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  COMPLETED: 'Complete',
  FAILED: 'Failed',
};

export default function DocumentsPage() {
  const runs = useProjectsStore((state) => state.runs);
  const getProject = useProjectsStore((state) => state.getProject);

  // Get all runs, sorted by most recent first
  const recentDocuments = useMemo(() => {
    return runs
      .map((run) => {
        const project = getProject(run.projectId);
        return {
          id: run.id,
          name: run.documentTitle || run.templateName || 'Untitled Document',
          project: project?.name || 'Unknown Project',
          projectId: run.projectId,
          updatedAt: run.completedAt || run.createdAt,
          status: run.status as keyof typeof statusColors,
        };
      })
      .sort((a, b) => {
        // Sort by most recent first
        const dateA = a.updatedAt instanceof Date ? a.updatedAt : new Date(a.updatedAt);
        const dateB = b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt);
        return dateB.getTime() - dateA.getTime();
      });
  }, [runs, getProject]);
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Recent Documents</h1>
          <p className="mt-1 text-muted-foreground">
            View and manage your generated documentation
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents..."
            className="input-glass pl-10 w-64"
          />
        </div>
      </div>

      {/* Documents List - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="glass-panel divide-y divide-glass-border">
          {recentDocuments.map((doc) => (
            <Link
              key={doc.id}
              href={`/projects/${doc.projectId}/runs/${doc.id}`}
              className="flex items-center justify-between p-4 transition-colors hover:bg-glass-bg cursor-pointer block"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-glass-bg">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-medium">{doc.name}</h3>
                  <p className="text-sm text-muted-foreground">{doc.project}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap min-w-[80px] text-center ${
                    statusColors[doc.status]
                  }`}
                >
                  {statusLabels[doc.status]}
                </span>
                <div className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap min-w-[100px] justify-end">
                  <Clock className="h-4 w-4" />
                  {formatRelativeTime(doc.updatedAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Empty State */}
        {recentDocuments.length === 0 && (
        <div className="glass-panel p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No documents yet</h3>
          <p className="mt-2 text-muted-foreground">
            Generate your first document from a project template
          </p>
        </div>
        )}
      </div>
    </div>
  );
}

