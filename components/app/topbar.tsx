import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { NewMenu } from "./new-menu";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex-1">
        <Breadcrumbs />
      </div>
      <CommandPalette />
      <NewMenu />
    </header>
  );
}
