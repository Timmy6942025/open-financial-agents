"use client";

import { memo, useCallback, useRef, useState, type FC, type PropsWithChildren } from "react";
import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { useScrollLock } from "@assistant-ui/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

function ToolGroupRoot({ className, open: controlledOpen, onOpenChange: controlledOnOpenChange, defaultOpen = false, children, ...props }: React.ComponentProps<typeof Collapsible> & { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean }) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) lockScroll();
    if (!isControlled) setUncontrolledOpen(open);
    controlledOnOpenChange?.(open);
  }, [lockScroll, isControlled, controlledOnOpenChange]);

  return (
    <Collapsible ref={collapsibleRef} data-slot="tool-group-root" open={isOpen} onOpenChange={handleOpenChange}
      className={cn("aui-tool-group-root group/tool-group w-full rounded-lg border py-3", className)}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties} {...props}>
      {children}
    </Collapsible>
  );
}

function ToolGroupTrigger({ count, active = false, className, ...props }: React.ComponentProps<typeof CollapsibleTrigger> & { count: number; active?: boolean }) {
  const label = `${count} tool ${count === 1 ? "call" : "calls"}`;
  return (
    <CollapsibleTrigger data-slot="tool-group-trigger"
      className={cn("aui-tool-group-trigger group/trigger flex items-center gap-2 px-4 text-sm transition-colors", className)} {...props}>
      {active && <LoaderIcon className="aui-tool-group-trigger-loader size-4 shrink-0 animate-spin" />}
      <span className="aui-tool-group-trigger-label-wrapper relative inline-block grow text-start leading-none font-medium">
        <span>{label}</span>
        {active && <span aria-hidden className="aui-tool-group-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none">{label}</span>}
      </span>
      <ChevronDownIcon className={cn("aui-tool-group-trigger-chevron size-4 shrink-0", "transition-transform duration-(--animation-duration) ease-out", "group-data-[state=closed]/trigger:-rotate-90", "group-data-[state=open]/trigger:rotate-0")} />
    </CollapsibleTrigger>
  );
}

function ToolGroupContent({ className, children, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent data-slot="tool-group-content"
      className={cn("aui-tool-group-content relative overflow-hidden text-sm outline-none", "data-[state=closed]:animate-collapsible-up", "data-[state=open]:animate-collapsible-down", "data-[state=open]:duration-(--animation-duration)", "data-[state=closed]:duration-(--animation-duration)", className)} {...props}>
      <div className="mt-3 flex flex-col gap-2 border-t px-4 pt-3">{children}</div>
    </CollapsibleContent>
  );
}

export { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent };
