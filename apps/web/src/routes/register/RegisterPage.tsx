import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  guestCreateRequestSchema,
  type GuestCreateRequest,
  type Guest,
} from "shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

// Increment 1 — see docs/architecture.md § Prototype reference: no payment step
// here (that's a front-desk action, see Increment 1b / nfr.md § Security & Privacy).
// Field-level error text is looked up by field name via i18next, never rendered
// from the Zod schema directly — see the schema's own comment for why.
export function RegisterPage() {
  const { t } = useTranslation();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [submitError, setSubmitError] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GuestCreateRequest>({
    resolver: zodResolver(guestCreateRequestSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      declaredWeightKg: undefined,
      consent: false,
    },
  });

  async function onSubmit(values: GuestCreateRequest) {
    setSubmitError(false);
    const response = await fetch("/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, phone: values.phone || undefined }),
    });
    if (!response.ok) {
      setSubmitError(true);
      return;
    }
    setGuest((await response.json()) as Guest);
  }

  if (guest) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-2xl font-semibold">{t("register.success.title")}</h1>
        <p className="text-muted-foreground mt-2">
          {t("register.success.lead", { name: guest.name })}
        </p>
        <p
          data-testid="guest-code"
          className="mt-2 text-4xl font-bold tracking-wide"
        >
          {guest.code}
        </p>
        <p className="text-muted-foreground mt-4 text-sm">
          {t("register.success.note")}
        </p>
        <Button
          className="mt-6"
          onClick={() => {
            setGuest(null);
            reset();
          }}
        >
          {t("register.success.again")}
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">{t("register.title")}</h1>
      <p className="text-muted-foreground mt-2">{t("register.lead")}</p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
      >
        <div className="grid gap-2">
          <Label htmlFor="name">{t("register.form.name")}</Label>
          <Input id="name" {...register("name")} aria-invalid={!!errors.name} />
          {errors.name && (
            <p className="text-destructive text-sm">{t("register.errors.name")}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">{t("register.form.email")}</Label>
          <Input
            id="email"
            type="email"
            {...register("email")}
            aria-invalid={!!errors.email}
          />
          {errors.email && (
            <p className="text-destructive text-sm">{t("register.errors.email")}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="phone">{t("register.form.phone")}</Label>
          <Input id="phone" {...register("phone")} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="declaredWeightKg">
            {t("register.form.declaredWeightKg")}
          </Label>
          <Input
            id="declaredWeightKg"
            type="number"
            {...register("declaredWeightKg", { valueAsNumber: true })}
            aria-invalid={!!errors.declaredWeightKg}
          />
          <p className="text-muted-foreground text-xs">
            {t("register.form.declaredWeightKgHint")}
          </p>
          {errors.declaredWeightKg && (
            <p className="text-destructive text-sm">
              {t("register.errors.declaredWeightKg")}
            </p>
          )}
        </div>

        <div className="flex items-start gap-2">
          <Controller
            control={control}
            name="consent"
            render={({ field }) => (
              <Checkbox
                id="consent"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                aria-invalid={!!errors.consent}
              />
            )}
          />
          <Label htmlFor="consent" className="font-normal">
            {t("register.form.consent")}
          </Label>
        </div>
        {errors.consent && (
          <p className="text-destructive text-sm">{t("register.errors.consent")}</p>
        )}

        {submitError && (
          <p className="text-destructive text-sm">{t("register.errors.submit")}</p>
        )}

        <Button type="submit" disabled={isSubmitting}>
          {t("register.form.submit")}
        </Button>
      </form>
    </main>
  );
}
