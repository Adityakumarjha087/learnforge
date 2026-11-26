"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ className, ...p }: TabsPrimitive.TabsListProps) => <TabsPrimitive.List className={cn("inline-flex gap-1 rounded-lg bg-muted p-1", className)} {...p} />;
export const TabsTrigger = ({ className, ...p }: TabsPrimitive.TabsTriggerProps) => (
  <TabsPrimitive.Trigger className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer", className)} {...p} />
);
export const TabsContent = ({ className, ...p }: TabsPrimitive.TabsContentProps) => <TabsPrimitive.Content className={cn("mt-4", className)} {...p} />;
