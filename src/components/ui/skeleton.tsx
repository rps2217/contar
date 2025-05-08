import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md bg-muted", className)} // Removed animate-pulse
      {...props}
    />
  )
}

export { Skeleton }
