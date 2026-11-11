"use client"
import { MarkdownTextPrimitive, memoizeMarkdownComponents } from "@assistant-ui/react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

// Markdown elements on theme tokens only (no typography plugin).
const components = memoizeMarkdownComponents({
  h1: ({ className, ...p }) => <h1 className={cn("mt-4 mb-2 text-lg font-semibold first:mt-0", className)} {...p} />,
  h2: ({ className, ...p }) => <h2 className={cn("mt-4 mb-2 text-base font-semibold first:mt-0", className)} {...p} />,
  h3: ({ className, ...p }) => <h3 className={cn("mt-3 mb-1.5 text-sm font-semibold first:mt-0", className)} {...p} />,
  p: ({ className, ...p }) => <p className={cn("my-2 leading-relaxed first:mt-0 last:mb-0", className)} {...p} />,
  a: ({ className, ...p }) => <a className={cn("font-medium text-primary underline underline-offset-4", className)} target="_blank" rel="noreferrer" {...p} />,
  ul: ({ className, ...p }) => <ul className={cn("my-2 ml-5 list-disc space-y-1", className)} {...p} />,
  ol: ({ className, ...p }) => <ol className={cn("my-2 ml-5 list-decimal space-y-1", className)} {...p} />,
  blockquote: ({ className, ...p }) => <blockquote className={cn("my-2 border-l-2 pl-3 text-muted-foreground", className)} {...p} />,
  hr: ({ className, ...p }) => <hr className={cn("my-4 border-border", className)} {...p} />,
  table: ({ className, ...p }) => (
    <div className="my-2 overflow-x-auto rounded-lg border">
      <table className={cn("w-full text-sm", className)} {...p} />
    </div>
  ),
  th: ({ className, ...p }) => <th className={cn("border-b bg-muted/50 px-3 py-1.5 text-left font-medium", className)} {...p} />,
  td: ({ className, ...p }) => <td className={cn("border-b px-3 py-1.5 last:border-b-0", className)} {...p} />,
  pre: ({ className, ...p }) => <pre className={cn("my-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs", className)} {...p} />,
  code: ({ className, ...p }) => <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] in-[pre]:bg-transparent in-[pre]:p-0", className)} {...p} />,
})

/** Assistant text part: markdown, revealed smoothly while it streams. */
export function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="text-sm break-words *:animate-fade-in" components={components} />
}
