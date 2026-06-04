"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { FileTextIcon, PencilIcon, SearchIcon, FolderSearchIcon, TerminalIcon, FileEditIcon } from "lucide-react";

function ToolShell({ icon: Icon, label, args, result, status }: {
  icon: React.ElementType;
  label: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: { type: string };
}) {
  const resultText = result != null
    ? typeof result === "string" ? result : JSON.stringify(result, null, 2)
    : null;

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <Icon className="size-4 text-blue-500 shrink-0" />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        {status.type === "running" && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs text-gray-400">Running</span>
          </span>
        )}
        {status.type === "complete" && (
          <span className="ml-auto text-xs text-green-600 dark:text-green-400">Complete</span>
        )}
        {status.type === "incomplete" && (
          <span className="ml-auto text-xs text-red-500">Error</span>
        )}
      </div>
      {args.path != null && (
        <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 font-mono">
          {String(args.path)}
        </div>
      )}
      {args.pattern != null && (
        <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 font-mono">
          grep: {String(args.pattern)}
        </div>
      )}
      {args.command != null && (
        <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 font-mono">
          $ {String(args.command)}
        </div>
      )}
      {resultText && status.type === "complete" && (
        <div className="px-4 py-2 max-h-64 overflow-auto">
          <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono">
            {resultText.slice(0, 2000)}
          </pre>
        </div>
      )}
    </div>
  );
}

export const ReadToolUI = makeAssistantToolUI({
  toolName: "read",
  render: ({ args, result, status }) => (
    <ToolShell icon={FileTextIcon} label="Read File" args={args} result={result} status={status} />
  ),
});

export const WriteToolUI = makeAssistantToolUI({
  toolName: "write",
  render: ({ args, result, status }) => (
    <ToolShell icon={PencilIcon} label="Write File" args={args} result={result} status={status} />
  ),
});

export const EditToolUI = makeAssistantToolUI({
  toolName: "edit",
  render: ({ args, result, status }) => (
    <ToolShell icon={FileEditIcon} label="Edit File" args={args} result={result} status={status} />
  ),
});

export const GrepToolUI = makeAssistantToolUI({
  toolName: "grep",
  render: ({ args, result, status }) => (
    <ToolShell icon={SearchIcon} label="Search Files" args={args} result={result} status={status} />
  ),
});

export const GlobToolUI = makeAssistantToolUI({
  toolName: "glob",
  render: ({ args, result, status }) => (
    <ToolShell icon={FolderSearchIcon} label="Find Files" args={args} result={result} status={status} />
  ),
});

export const BashToolUI = makeAssistantToolUI({
  toolName: "bash",
  render: ({ args, result, status }) => (
    <ToolShell icon={TerminalIcon} label="Run Command" args={args} result={result} status={status} />
  ),
});
