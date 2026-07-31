"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, XIcon } from "lucide-react"

// Base UI's filterable counterpart to Select (see select.tsx) — use this
// instead whenever the item list can grow large enough that scrolling a
// plain dropdown becomes painful (e.g. a customer picker). Same `items:
// {value, label}[]` convention as Select, so swapping one for the other at a
// call site only touches the JSX, not the data shape.
const Combobox = ComboboxPrimitive.Root

function ComboboxInputGroup({
  className,
  ...props
}: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn("relative flex w-full items-center", className)}
      {...props}
    />
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent py-2 pr-14 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
        className
      )}
      {...props}
    />
  )
}

function ComboboxButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-button-group"
      className={cn("absolute inset-y-0 right-1 flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    >
      <XIcon className="size-3.5" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxTrigger({ className, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    >
      <ComboboxPrimitive.Icon render={<ChevronDownIcon className="pointer-events-none size-4" />} />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  emptyMessage,
  children,
  ...props
}: Omit<ComboboxPrimitive.Popup.Props, "children"> &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> & {
    emptyMessage?: React.ReactNode
    children?: ComboboxPrimitive.List.Props["children"]
  }) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {emptyMessage !== undefined && (
            <ComboboxPrimitive.Empty className="px-2 py-4 text-center text-sm text-muted-foreground">{emptyMessage}</ComboboxPrimitive.Empty>
          )}
          <ComboboxPrimitive.List data-slot="combobox-list" className="p-1">
            {children}
          </ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

export {
  Combobox,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxButtonGroup,
  ComboboxClear,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
}
