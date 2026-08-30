import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-border bg-raised px-3 py-2 text-sm placeholder:text-faint transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-invalid:border-danger aria-invalid:outline-danger disabled:cursor-not-allowed disabled:opacity-50 field-sizing-content",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
