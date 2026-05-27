"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  RotateCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatShareText, type ShareTextContext } from "@/lib/share-link/format-text";
import {
  createShareLink,
  revokeShareLink,
  rotateShareLink,
} from "@/lib/actions/share-links";

export type SendToCrewState = {
  eventId: string;
  timeZone: string;
  baseContext: Omit<ShareTextContext, "shareUrl">;
  link: {
    id: string;
    slug: string;
    createdAt: string;
    revokedAt: string | null;
    lastOpenedAt: string | null;
  } | null;
  siteUrl: string;
};

type Props = {
  state: SendToCrewState;
};

export function SendToCrewModal({ state }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Track the live slug locally so generate/rotate/revoke flips the UI
  // without a full server round-trip.
  const [link, setLink] = useState(state.link);

  const shareUrl = link ? `${state.siteUrl}/j/${link.slug}` : null;

  const textBlock = useMemo(
    () =>
      formatShareText(
        { ...state.baseContext, shareUrl },
        state.timeZone,
      ),
    [state.baseContext, state.timeZone, shareUrl],
  );

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("send");
    const next = params.toString();
    router.push(`${pathname}${next ? `?${next}` : ""}`);
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(textBlock);
      toast.success("Copied — paste into any messaging app");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  async function copyUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  function generate() {
    startTransition(async () => {
      const res = await createShareLink({ eventId: state.eventId });
      if (!res.ok) {
        toast.error("Couldn't generate link", { description: res.error });
        return;
      }
      setLink({
        id: res.data.linkId,
        slug: res.data.slug,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastOpenedAt: null,
      });
      toast.success("Link generated");
      router.refresh();
    });
  }

  function rotate() {
    startTransition(async () => {
      const res = await rotateShareLink({ eventId: state.eventId });
      if (!res.ok) {
        toast.error("Couldn't rotate link", { description: res.error });
        return;
      }
      setLink({
        id: res.data.linkId,
        slug: res.data.slug,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastOpenedAt: null,
      });
      toast.success("Link rotated — previous URL is now dead");
      router.refresh();
    });
  }

  function revoke() {
    if (!link) return;
    const id = link.id;
    startTransition(async () => {
      const res = await revokeShareLink({ linkId: id });
      if (!res.ok) {
        toast.error("Couldn't revoke link", { description: res.error });
        return;
      }
      setLink(null);
      toast.success("Link revoked");
      router.refresh();
    });
  }

  const encoded = encodeURIComponent(textBlock);
  const waLink = `whatsapp://send?text=${encoded}`;
  const smsLink = `sms:?body=${encoded}`;
  const mailLink = `mailto:?body=${encoded}`;

  return (
    <Dialog open onOpenChange={(next) => (!next ? close() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to crew</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="text" className="flex-1">
          <TabsList className="w-full">
            <TabsTrigger value="text" className="flex-1 gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> Copy text
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1 gap-1">
              <Link2 className="h-3.5 w-3.5" /> Shareable link
            </TabsTrigger>
          </TabsList>

          {/* Copy text tab */}
          <TabsContent value="text" className="space-y-3 pt-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
              {textBlock}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={copyText} className="gap-1">
                <Copy className="h-4 w-4" /> Copy
              </Button>
              <Button asChild type="button" variant="outline" size="sm" className="gap-1">
                <a href={waLink}>
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </Button>
              <Button asChild type="button" variant="outline" size="sm" className="gap-1">
                <a href={smsLink}>
                  <Smartphone className="h-3.5 w-3.5" /> Messages
                </a>
              </Button>
              <Button asChild type="button" variant="outline" size="sm" className="gap-1">
                <a href={mailLink}>
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              </Button>
            </div>
            {!shareUrl ? (
              <p className="text-[11px] text-muted-foreground">
                No share link yet — the text block above doesn&apos;t include a
                URL. Generate one in the Shareable link tab so the crew can
                see photos + mark status from their phone.
              </p>
            ) : null}
          </TabsContent>

          {/* Shareable link tab */}
          <TabsContent value="link" className="space-y-3 pt-3">
            {link && shareUrl ? (
              <>
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Live link
                  </p>
                  <div className="flex gap-1">
                    <Input value={shareUrl} readOnly className="font-mono text-xs" />
                    <Button type="button" variant="outline" size="sm" onClick={copyUrl}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {link.lastOpenedAt
                    ? `Last opened ${formatDistanceToNow(parseISO(link.lastOpenedAt), { addSuffix: true })}`
                    : "Not opened yet."}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={rotate}
                    disabled={pending}
                    className="gap-1"
                  >
                    {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                    Rotate token
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1 text-destructive hover:text-destructive"
                        disabled={pending}
                      >
                        <Trash2 className="h-3 w-3" /> Revoke
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke this link?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The URL stops working immediately. Anyone who&apos;s
                          opened it will see &quot;no longer active&quot;.
                          You can generate a new one any time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={revoke}>Revoke</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                  <p className="font-medium text-foreground">
                    <Check className="mr-1 inline h-3 w-3" />
                    What the crew sees
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>Address with &quot;Open in Maps&quot; link</li>
                    <li>Customer name + phone (tap-to-call)</li>
                    <li>Stone, edge, cutouts, notes</li>
                    <li>Order photos</li>
                    <li>Buttons to mark on-the-way / arrived / complete</li>
                  </ul>
                </div>
              </>
            ) : (
              <div className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
                <p>No active share link for this event.</p>
                <p className="text-[11px] text-muted-foreground">
                  Generate one to give the crew a phone-friendly view of the
                  job details + photos, with on-page buttons to mark
                  status (no login required).
                </p>
                <Button type="button" onClick={generate} disabled={pending} className="gap-1">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Generate link
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
