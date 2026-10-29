import { useState, type DragEvent } from "react";
import {
  GripVertical,
  ExternalLink,
  Building2,
  X,
} from "lucide-react";
import { useApplications, useUpdateApplication } from "../hooks/useApplications";
import type { ApplicationWithJob } from "../lib/types";

const COLUMNS: { key: string; label: string; color: string }[] = [
  { key: "interested", label: "Interested", color: "bg-blue-500" },
  { key: "applied", label: "Applied", color: "bg-indigo-500" },
  { key: "interview", label: "Interview", color: "bg-amber-500" },
  { key: "offer", label: "Offer", color: "bg-green-500" },
  { key: "rejected", label: "Rejected", color: "bg-red-500" },
  { key: "withdrawn", label: "Withdrawn", color: "bg-gray-500" },
];

export function Applications() {
  const { data: apps = [], isLoading } = useApplications(null);
  const updateApp = useUpdateApplication();
  const [dragging, setDragging] = useState<number | null>(null);
  const [detailApp, setDetailApp] = useState<ApplicationWithJob | null>(null);

  const grouped: Record<string, ApplicationWithJob[]> = {};
  for (const col of COLUMNS) grouped[col.key] = [];
  for (const app of apps) {
    if (grouped[app.status]) grouped[app.status].push(app);
  }

  const onDragStart = (e: DragEvent, appId: number) => {
    e.dataTransfer.setData("text/plain", String(appId));
    setDragging(appId);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDrop = (e: DragEvent, newStatus: string) => {
    e.preventDefault();
    const appId = Number(e.dataTransfer.getData("text/plain"));
    if (appId && apps.find((a) => a.id === appId)?.status !== newStatus) {
      updateApp.mutate({ id: appId, status: newStatus });
    }
    setDragging(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
        <div className="grid grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
      <p className="text-sm text-gray-500">
        Drag cards between columns to update status.
      </p>

      <div className="grid grid-cols-6 gap-3">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, col.key)}
            className={`flex flex-col rounded-xl border bg-gray-50 ${
              dragging !== null ? "border-blue-300 border-dashed" : "border-gray-200"
            }`}
          >
            {/* Column Header */}
            <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
              <div className={`h-2 w-2 rounded-full ${col.color}`} />
              <span className="text-xs font-semibold text-gray-700">
                {col.label}
              </span>
              <span className="ml-auto rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                {grouped[col.key].length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 220px)" }}>
              {grouped[col.key].map((app) => (
                <div
                  key={app.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, app.id)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => setDetailApp(app)}
                  className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:shadow-md"
                >
                  <div className="mb-1 flex items-start gap-1">
                    <GripVertical className="mt-0.5 h-3 w-3 shrink-0 cursor-grab text-gray-300" />
                    <h4 className="text-xs font-semibold leading-tight text-gray-800">
                      {app.job_title}
                    </h4>
                  </div>
                  {app.job_company && (
                    <p className="flex items-center gap-1 text-xs text-gray-500">
                      <Building2 className="h-3 w-3" />
                      {app.job_company}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Detail Panel */}
      {detailApp && (
        <DetailPanel app={detailApp} onClose={() => setDetailApp(null)} />
      )}
    </div>
  );
}

function DetailPanel({
  app,
  onClose,
}: {
  app: ApplicationWithJob;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{app.job_title}</h2>
            {app.job_company && (
              <p className="text-sm text-gray-500">{app.job_company}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <span className="font-medium text-gray-600 w-28">Status:</span>
            <span className="capitalize">{app.status}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-600 w-28">Applied:</span>
            <span>{app.applied_at ? new Date(app.applied_at).toLocaleDateString() : "--"}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-600 w-28">Follow-up:</span>
            <span>{app.follow_up_date ? new Date(app.follow_up_date).toLocaleDateString() : "--"}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-600 w-28">Notes:</span>
            <span className="text-gray-700">{app.notes || "None"}</span>
          </div>
          <a
            href={app.job_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            View Listing <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
