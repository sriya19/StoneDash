"use client";

import { useRouter } from "next/navigation";
import { Plus, User, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// "+ New" dropdown. For Task 1 the dialog triggers live on /orders and
// /customers (via ?new=1), and this menu just routes there. That keeps the
// shell free of dialog state that only those pages care about.
export function NewMenu() {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/orders?new=1")}>
          <Wrench className="h-4 w-4" /> New order
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/customers?new=1")}>
          <User className="h-4 w-4" /> New customer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
