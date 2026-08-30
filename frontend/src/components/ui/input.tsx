import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-faint h-9 w-full min-w-0 rounded-md border border-border bg-raised px-3 py-1 text-sm transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        "aria-invalid:border-danger aria-invalid:outline-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
