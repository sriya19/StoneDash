"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OnboardingInput, type OnboardingInputT } from "@/lib/validators/onboarding";
import { completeOnboarding } from "@/lib/actions/onboarding";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function prefixFromSlug(slug: string): string {
  const letters = slug.replace(/[^a-z]/g, "");
  return letters.slice(0, 2).toUpperCase();
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

type Props = { initialFullName: string };

export function OnboardingForm({ initialFullName }: Props) {
  const router = useRouter();
  const [slugDirty, setSlugDirty] = useState(false);
  const [prefixDirty, setPrefixDirty] = useState(false);
  const [pending, setPending] = useState(false);

  const form = useForm<OnboardingInputT>({
    resolver: zodResolver(OnboardingInput),
    defaultValues: {
      fullName: initialFullName,
      shopName: "",
      slug: "",
      timezone: detectTimezone(),
      currency: "USD",
      orderPrefix: "",
      orderSeqStart: 1000,
    },
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const shopName = watch("shopName");
  const slug = watch("slug");
  const currency = watch("currency");

  // Auto-derive slug from shopName while the user hasn't touched the slug field.
  useEffect(() => {
    if (!slugDirty) {
      setValue("slug", slugify(shopName ?? ""), { shouldValidate: false });
    }
  }, [shopName, slugDirty, setValue]);

  // Auto-derive order_prefix from slug while prefix hasn't been touched.
  useEffect(() => {
    if (!prefixDirty) {
      setValue("orderPrefix", prefixFromSlug(slug ?? ""), { shouldValidate: false });
    }
  }, [slug, prefixDirty, setValue]);

  async function onSubmit(values: OnboardingInputT) {
    setPending(true);
    const result = await completeOnboarding(values);
    if (!result.ok) {
      toast.error("Couldn't set up your shop", { description: result.error });
      setPending(false);
      return;
    }
    toast.success("Shop created");
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input id="fullName" {...register("fullName")} autoComplete="name" />
        {errors.fullName ? (
          <p className="text-xs text-destructive">{errors.fullName.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="shopName">Shop name</Label>
        <Input id="shopName" placeholder="Top Marble & Granite" {...register("shopName")} />
        {errors.shopName ? (
          <p className="text-xs text-destructive">{errors.shopName.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">URL slug</Label>
        <Input
          id="slug"
          {...register("slug", {
            onChange: () => setSlugDirty(true),
          })}
          placeholder="top-marble-granite"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, numbers, and dashes. Shown in URLs and invite links.
        </p>
        {errors.slug ? (
          <p className="text-xs text-destructive">{errors.slug.message}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Input id="timezone" {...register("timezone")} />
          {errors.timezone ? (
            <p className="text-xs text-destructive">{errors.timezone.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select
            value={currency}
            onValueChange={(value) =>
              setValue("currency", value, { shouldValidate: true })
            }
          >
            <SelectTrigger id="currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD · US Dollar</SelectItem>
              <SelectItem value="CAD">CAD · Canadian Dollar</SelectItem>
              <SelectItem value="MXN">MXN · Mexican Peso</SelectItem>
              <SelectItem value="EUR">EUR · Euro</SelectItem>
              <SelectItem value="GBP">GBP · Pound Sterling</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="orderPrefix">Order prefix</Label>
          <Input
            id="orderPrefix"
            {...register("orderPrefix", {
              onChange: () => setPrefixDirty(true),
            })}
            placeholder="TM"
            maxLength={6}
          />
          <p className="text-xs text-muted-foreground">
            Shown before the sequence (e.g. <span className="font-mono">TM-1042</span>).
          </p>
          {errors.orderPrefix ? (
            <p className="text-xs text-destructive">{errors.orderPrefix.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="orderSeqStart">Starting number</Label>
          <Input
            id="orderSeqStart"
            type="number"
            min={1}
            {...register("orderSeqStart", { valueAsNumber: true })}
          />
          <p className="text-xs text-muted-foreground">
            Continue from an existing paper or Excel sequence if you have one.
          </p>
          {errors.orderSeqStart ? (
            <p className="text-xs text-destructive">{errors.orderSeqStart.message}</p>
          ) : null}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Create shop
      </Button>
    </form>
  );
}
