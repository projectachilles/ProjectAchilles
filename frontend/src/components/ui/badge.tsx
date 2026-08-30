import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[11px] font-medium tracking-wide w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-border bg-raised text-muted",
        accent: "border-accent/30 bg-accent-dim text-accent",
        high: "border-danger/30 bg-danger-dim text-danger",
        medium: "border-warning/30 bg-warning-dim text-warning",
        low: "border-info/30 bg-info-dim text-info",
        outline: "border-border text-muted",
        /* Legacy aliases retained for existing call sites */
        secondary: "border-border bg-raised text-muted",
        destructive: "border-danger/30 bg-danger-dim text-danger",
        ghost: "border-transparent text-muted [a&]:hover:bg-raised [a&]:hover:text-foreground",
        link: "border-transparent text-accent underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Severity badges add mono + uppercase per the design recipe. */
const severityBadgeClass = "font-mono uppercase"

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, severityBadgeClass }
