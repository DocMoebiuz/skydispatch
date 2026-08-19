import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  guestCreateRequestSchema,
  type GuestCreateRequest,
  type Guest,
  type FlightDay,
} from "shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Increment 2 — two-step form (contact, then weight/consent/newsletter, matching
// the prototype's step shape/card outline) plus the group registration loop: the
// FIRST time a registrant adds another person, that's when we ask for a group name
// — not upfront. It then applies retroactively to the person already registered
// (via POST /api/guests/{id}/actions/start-group) and automatically to everyone
// after. See docs/architecture.md § Group registration and § Prototype reference.
//
// No payment step (that's a front-desk action, see Increment 1b / nfr.md §
// Security & Privacy). Field-level error text is looked up by field name via
// i18next, never rendered from the Zod schema directly — see the schema's comment.

type FormStep = "contact" | "weight";
type Phase = "form" | "success" | "group-prompt" | "done";

const defaultValues: GuestCreateRequest = {
  name: "",
  email: "",
  phone: "",
  declaredWeightKg: undefined as unknown as number,
  consent: false,
  newsletter: false,
};

export function RegisterPage() {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>("form");
  const [formStep, setFormStep] = useState<FormStep>("contact");
  const [guest, setGuest] = useState<Guest | null>(null);
  const [sessionGuests, setSessionGuests] = useState<
    { code: string; name: string }[]
  >([]);
  const [submitError, setSubmitError] = useState(false);

  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupPromptError, setGroupPromptError] = useState(false);
  const [startingGroup, setStartingGroup] = useState(false);

  // 404 means no flight day configured yet — not an error, just falls back to 0
  // (see apps/api flightday.ts's getFlightDay for why this isn't a 200+null body).
  const [pricePerGuestEur, setPricePerGuestEur] = useState(0);
  useEffect(() => {
    fetch("/api/flightday")
      .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
      .then((d) => {
        if (d) setPricePerGuestEur(d.pricePerGuestEur);
      })
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    control,
    trigger,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GuestCreateRequest>({
    resolver: zodResolver(guestCreateRequestSchema),
    defaultValues,
  });

  async function goToWeightStep() {
    const ok = await trigger(["name", "email", "phone"]);
    if (ok) setFormStep("weight");
  }

  async function onSubmit(values: GuestCreateRequest) {
    setSubmitError(false);
    const response = await fetch("/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...values,
        phone: values.phone || undefined,
        group: groupId && groupName ? { groupId, groupName } : undefined,
      }),
    });
    if (!response.ok) {
      setSubmitError(true);
      return;
    }
    const created = (await response.json()) as Guest;
    setGuest(created);
    setSessionGuests((prev) => [...prev, { code: created.code, name: created.name }]);
    setPhase("success");
  }

  function startNextRegistration() {
    reset(defaultValues);
    setFormStep("contact");
    setPhase("form");
  }

  function addAnother() {
    if (groupId) {
      startNextRegistration();
    } else {
      setGroupNameInput("");
      setGroupPromptError(false);
      setPhase("group-prompt");
    }
  }

  async function confirmGroupName() {
    const name = groupNameInput.trim();
    if (!name) {
      setGroupPromptError(true);
      return;
    }
    if (!guest) return; // can't happen — group-prompt only shows after a guest exists
    setStartingGroup(true);
    try {
      const response = await fetch(`/api/guests/${guest.id}/actions/start-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName: name }),
      });
      if (!response.ok) {
        setGroupPromptError(true);
        return;
      }
      const updated = (await response.json()) as Guest;
      setGroupId(updated.groupId ?? null);
      setGroupName(updated.groupName ?? null);
      startNextRegistration();
    } finally {
      setStartingGroup(false);
    }
  }

  if (phase === "group-prompt") {
    return (
      <main className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("register.group.prompt.title")}</CardTitle>
            <CardDescription>{t("register.group.prompt.lead")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              <Label htmlFor="groupName">{t("register.group.prompt.label")}</Label>
              <Input
                id="groupName"
                value={groupNameInput}
                onChange={(e) => {
                  setGroupNameInput(e.target.value);
                  setGroupPromptError(false);
                }}
                aria-invalid={groupPromptError}
              />
              {groupPromptError && (
                <p className="text-destructive text-sm">
                  {t("register.group.prompt.error")}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={() => void confirmGroupName()}
              disabled={startingGroup}
            >
              {t("register.group.prompt.submit")}
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  if (phase === "success" && guest) {
    return (
      <main className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("register.success.title")}</CardTitle>
            <CardDescription>
              {t("register.success.lead", { name: guest.name })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p data-testid="guest-code" className="text-4xl font-bold tracking-wide">
              {guest.code}
            </p>
            {groupName && (
              <p className="text-muted-foreground text-sm">
                {t("register.success.groupLabel")}: {groupName}
              </p>
            )}
            <p className="text-muted-foreground text-sm">{t("register.success.note")}</p>

            {sessionGuests.length > 1 && (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {t("register.success.sessionListHeading")}
                </p>
                <ul className="text-sm">
                  {sessionGuests.map((g) => (
                    <li key={g.code} data-testid="session-guest">
                      {g.code} — {g.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button
              className="w-full"
              variant="outline"
              onClick={addAnother}
              data-testid="add-another-button"
            >
              {t("register.success.again")}
            </Button>
            <Button
              className="w-full"
              onClick={() => setPhase("done")}
              data-testid="finish-registration-button"
            >
              {t("register.success.finish")}
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  if (phase === "done" && guest) {
    const total = pricePerGuestEur * sessionGuests.length;
    return (
      <main className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("register.done.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3">
              <li className="flex gap-2 text-sm">
                <span className="font-semibold">1.</span>
                <span>
                  {t("register.done.step1", {
                    total: total.toFixed(2).replace(".", ",") + " €",
                  })}
                </span>
              </li>
              <li className="flex gap-2 text-sm">
                <span className="font-semibold">2.</span>
                <span>{t("register.done.step2")}</span>
              </li>
            </ol>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t("register.done.summaryHeading")}</p>
              <ul className="text-sm">
                {sessionGuests.map((g) => (
                  <li key={g.code} data-testid="session-guest">
                    {g.code} — {g.name}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
          <CardFooter>
            {/* guest.code (the last person registered this session) — the board
                looks up the whole group from any one member's code, see
                BoardPage's group-aware lookup. */}
            <Button asChild className="w-full">
              <Link
                to={`/board?code=${encodeURIComponent(guest.code)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("register.done.boardLink")}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("register.title")}</h1>
        <p className="text-muted-foreground">{t("register.lead")}</p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex gap-4 text-sm">
            <span
              className={cn(
                "font-medium",
                formStep === "contact" ? "text-primary" : "text-muted-foreground",
              )}
            >
              1. {t("register.steps.contact")}
            </span>
            <span
              className={cn(
                "font-medium",
                formStep === "weight" ? "text-primary" : "text-muted-foreground",
              )}
            >
              2. {t("register.steps.weight")}
            </span>
          </div>
        </CardHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          noValidate
        >
          {/* CardContent/CardFooter are the form's children here (the form has to
              wrap both so submit works), not Card's direct children — Card's own
              gap-6 only spaces CardHeader against this <form> as one item, so the
              form needs the matching flex flex-col gap-6 itself or CardContent and
              CardFooter collapse together with no gap at all. */}
          <CardContent className="flex flex-col gap-4">
            {formStep === "contact" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="name">{t("register.form.name")}</Label>
                  <Input id="name" {...register("name")} aria-invalid={!!errors.name} />
                  {errors.name && (
                    <p className="text-destructive text-sm">
                      {t("register.errors.name")}
                    </p>
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
                    <p className="text-destructive text-sm">
                      {t("register.errors.email")}
                    </p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="phone">{t("register.form.phone")}</Label>
                  <Input id="phone" {...register("phone")} />
                </div>
              </>
            )}

            {formStep === "weight" && (
              <>
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
                  <p className="text-destructive text-sm">
                    {t("register.errors.consent")}
                  </p>
                )}

                <div className="flex items-start gap-2">
                  <Controller
                    control={control}
                    name="newsletter"
                    render={({ field }) => (
                      <Checkbox
                        id="newsletter"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    )}
                  />
                  <Label htmlFor="newsletter" className="font-normal">
                    {t("register.form.newsletter")}
                  </Label>
                </div>

                {submitError && (
                  <p className="text-destructive text-sm">
                    {t("register.errors.submit")}
                  </p>
                )}
              </>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            {formStep === "contact" && (
              <Button
                type="button"
                className="w-full"
                onClick={() => void goToWeightStep()}
              >
                {t("register.form.next")}
              </Button>
            )}
            {formStep === "weight" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormStep("contact")}
                >
                  {t("register.form.back")}
                </Button>
                <Button type="submit" disabled={isSubmitting} className="flex-1">
                  {t("register.form.submit")}
                </Button>
              </>
            )}
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
