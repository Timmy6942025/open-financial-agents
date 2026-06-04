"use client";

import { memo, useCallback, useRef, useState } from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useScrollLock, useAuiState, type ReasoningMessagePartComponent } from "@assistant-ui/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

function ReasoningRoot({ className, open: controlledOpen, onOpenChange: controlledOnOpenChange, defaultOpen = false, children, ...props }: React.ComponentProps<typeof Collapsible> & { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean }) {
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
    <Collapsible ref={collapsibleRef} data-slot="reasoning-root" open={isOpen} onOpenChange={handleOpenChange}
      className={cn("aui-reasoning-root group/reasoning-root mb-4 w-full rounded-lg border px-3 py-2", className)}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties} {...props}>
      {children}
    </Collapsible>
  );
}

function ReasoningTrigger({ active, className, ...props }: React.ComponentProps<typeof CollapsibleTrigger> & { active?: boolean }) {
  return (
    <CollapsibleTrigger data-slot="reasoning-trigger"
      className={cn("aui-reasoning-trigger group/trigger text-muted-foreground hover:text-foreground flex max-w-[75%] items-center gap-2 py-1 text-sm transition-colors", className)} {...props}>
      <BrainIcon className="aui-reasoning-trigger-icon size-4 shrink-0" />
      <span className="aui-reasoning-trigger-label-wrapper relative inline-block leading-none">
        <span>Reasoning</span>
        {active && <span aria-hidden className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none">Reasoning</span>}
      </span>
      <ChevronDownIcon className={cn("aui-reasoning-trigger-chevron size-4 shrink-0", "transition-transform duration-(--animation-duration) ease-out", "group-data-[state=closed]/trigger:-rotate-90", "group-data-[state=open]/trigger:rotate-0")} />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({ className, children, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent data-slot="reasoning-content"
      className={cn("aui-reasoning-content text-muted-foreground relative overflow-hidden text-sm outline-none", "data-[state=closed]:animate-collapsible-up", "data-[state=open]:animate-collapsible-down", "data-[state=open]:duration-(--animation-duration)", "data-[state=closed]:duration-(--animation-duration)", className)} {...props}>
      {children}
    </CollapsibleContent>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="reasoning-text" className={cn("aui-reasoning-text relative z-0 max-h-64 space-y-4 overflow-y-auto ps-6 pt-2 pb-2 leading-relaxed", className)} {...props} />;
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;

export const Reasoning = memo(ReasoningImpl) as unknown as ReasoningMessagePartComponent & { Root: typeof ReasoningRoot; Trigger: typeof ReasoningTrigger; Content: typeof ReasoningContent; Text: typeof ReasoningText; };
Reasoning.displayName = "Reasoning";
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;

export { ReasoningRoot, ReasoningTrigger, ReasoningContent, ReasoningText };
