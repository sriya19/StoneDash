"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

type Props = {
  prevHref: string;
  nextHref: string;
  todayHref: string;
};

export function ScheduleNav({ prevHref, nextHref, todayHref }: Props) {
  return (
    <div className="flex items-center gap-1">
      <Button asChild variant="outline" size="icon" className="h-8 w-8">
        <Link href={prevHref} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm" className="h-8">
        <Link href={todayHref}>Today</Link>
      </Button>
      <Button asChild variant="outline" size="icon" className="h-8 w-8">
        <Link href={nextHref} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
