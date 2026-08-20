import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";

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

type FormStep = "contact" | "address" | "weight";
type Phase = "form" | "success" | "group-prompt" | "done";
type Address = { street: string; zipCode: string; city: string };

// Three separate dropdowns instead of a native <input type="date"> — a date
// picker/calendar widget is slow and unfamiliar for entering a birth date
// decades in the past (lots of back-clicking through months); day/month/year
// selects are the accessible, low-friction convention for this specific input.
const DOB_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
].map((label, i) => ({ value: i + 1, label }));
const DOB_CURRENT_YEAR = new Date().getFullYear();
// No stated minimum-age rule (see the schema's comment) — 100 years back is
// just a sane bound for a birth-year dropdown, not a business rule.
const DOB_YEARS = Array.from({ length: 100 }, (_, i) => DOB_CURRENT_YEAR - i);

function daysInMonth(month: number | null, year: number | null): number {
  if (!month) return 31;
  return new Date(year ?? DOB_CURRENT_YEAR, month, 0).getDate();
}

const defaultValues: GuestCreateRequest = {
  name: "",
  email: "",
  phone: "",
  declaredWeightKg: undefined as unknown as number,
  dateOfBirth: "",
  address: { street: "", zipCode: "", city: "" },
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

  // The first group member's address, captured once the group exists (see
  // confirmGroupName), offered to every later member as "reuse" — a UI convenience
  // only. The API always receives a full address either way; there's no
  // group-level address concept server-side.
  const [firstAddress, setFirstAddress] = useState<Address | null>(null);
  const [reuseAddress, setReuseAddress] = useState(true);
  const canReuseAddress = !!groupId && !!firstAddress;

  // Day/month/year dropdowns for dateOfBirth — combined into the "YYYY-MM-DD"
  // string the schema/API expect via setValue below, not registered directly.
  const [dobDay, setDobDay] = useState<number | null>(null);
  const [dobMonth, setDobMonth] = useState<number | null>(null);
  const [dobYear, setDobYear] = useState<number | null>(null);


  const {
    register,
    handleSubmit,
    control,
    trigger,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GuestCreateRequest>({
    resolver: zodResolver(guestCreateRequestSchema),
    defaultValues,
  });

  // Combine the three dropdowns into the "YYYY-MM-DD" string the form/API
  // expect — syncing into react-hook-form's own (external) store, not React
  // state, so belongs in an effect. Only writes a real value once all three
  // are picked, so trigger(["dateOfBirth", ...]) below still fails validation
  // on a partial selection instead of silently accepting one.
  useEffect(() => {
    if (dobDay && dobMonth && dobYear) {
      const mm = String(dobMonth).padStart(2, "0");
      const dd = String(dobDay).padStart(2, "0");
      setValue("dateOfBirth", `${dobYear}-${mm}-${dd}`, { shouldValidate: false });
    } else {
      setValue("dateOfBirth", "", { shouldValidate: false });
    }
  }, [dobDay, dobMonth, dobYear, setValue]);

  // Clamp the day when a month/year change makes the current selection
  // invalid (e.g. 31 → February) — done in the change handlers themselves,
  // not as a side effect of the combine effect above, per the
  // react-hooks/set-state-in-effect rule (own-state updates belong in the
  // event handler that caused them, not in an effect body).
  function handleDobMonthChange(month: number | null) {
    setDobMonth(month);
    const maxDay = daysInMonth(month, dobYear);
    if (dobDay && dobDay > maxDay) setDobDay(maxDay);
  }
  function handleDobYearChange(year: number | null) {
    setDobYear(year);
    const maxDay = daysInMonth(dobMonth, year);
    if (dobDay && dobDay > maxDay) setDobDay(maxDay);
  }

  async function goToAddressStep() {
    const ok = await trigger(["name", "email", "phone"]);
    if (ok) setFormStep("address");
  }

  async function goToWeightStep() {
    if (canReuseAddress && reuseAddress && firstAddress) {
      setValue("address", firstAddress, { shouldValidate: false });
    }
    const ok = await trigger(["dateOfBirth", "address.street", "address.zipCode", "address.city"]);
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
    setDobDay(null);
    setDobMonth(null);
    setDobYear(null);
    setFormStep("contact");
    setReuseAddress(true);
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
      setFirstAddress(updated.address);
      startNextRegistration();
    } finally {
      setStartingGroup(false);
    }
  }

  if (phase === "group-prompt") {
    return (
      <main className="bg-brand-gradient mx-auto min-h-screen max-w-md p-8">
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
      <main className="bg-brand-gradient mx-auto min-h-screen max-w-md p-8">
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
    return (
      <main className="bg-brand-gradient mx-auto min-h-screen max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("register.done.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3">
              <li className="flex gap-2 text-sm">
                <span className="font-semibold">1.</span>
                <span>{t("register.done.step1")}</span>
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
    <main className="bg-brand-gradient mx-auto flex min-h-screen max-w-md flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-primary flex items-center gap-2 text-2xl font-semibold">
          <Logo className="size-7 shrink-0" />
          {t("register.title")}
        </h1>
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
                formStep === "address" ? "text-primary" : "text-muted-foreground",
              )}
            >
              2. {t("register.steps.address")}
            </span>
            <span
              className={cn(
                "font-medium",
                formStep === "weight" ? "text-primary" : "text-muted-foreground",
              )}
            >
              3. {t("register.steps.weight")}
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

            {formStep === "address" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="dateOfBirthDay">{t("register.form.dateOfBirth")}</Label>
                  <div className="flex gap-2">
                    <Select
                      value={dobDay != null ? String(dobDay) : ""}
                      onValueChange={(v) => setDobDay(v ? Number(v) : null)}
                    >
                      <SelectTrigger
                        id="dateOfBirthDay"
                        data-testid="dob-day"
                        aria-invalid={!!errors.dateOfBirth}
                        className={cn("w-22.5", !!errors.dateOfBirth && "border-destructive")}
                      >
                        <SelectValue placeholder={t("register.form.dobDay")} />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: daysInMonth(dobMonth, dobYear) }, (_, i) => i + 1).map(
                          (day) => (
                            <SelectItem key={day} value={String(day)}>
                              {day}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <Select
                      value={dobMonth != null ? String(dobMonth) : ""}
                      onValueChange={(v) => handleDobMonthChange(v ? Number(v) : null)}
                    >
                      <SelectTrigger
                        data-testid="dob-month"
                        aria-invalid={!!errors.dateOfBirth}
                        className={cn("w-35", !!errors.dateOfBirth && "border-destructive")}
                      >
                        <SelectValue placeholder={t("register.form.dobMonth")} />
                      </SelectTrigger>
                      <SelectContent>
                        {DOB_MONTHS.map(({ value, label }) => (
                          <SelectItem key={value} value={String(value)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={dobYear != null ? String(dobYear) : ""}
                      onValueChange={(v) => handleDobYearChange(v ? Number(v) : null)}
                    >
                      <SelectTrigger
                        data-testid="dob-year"
                        aria-invalid={!!errors.dateOfBirth}
                        className={cn("w-25", !!errors.dateOfBirth && "border-destructive")}
                      >
                        <SelectValue placeholder={t("register.form.dobYear")} />
                      </SelectTrigger>
                      <SelectContent>
                        {DOB_YEARS.map((year) => (
                          <SelectItem key={year} value={String(year)}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {errors.dateOfBirth && (
                    <p className="text-destructive text-sm">
                      {t("register.errors.dateOfBirth")}
                    </p>
                  )}
                </div>

                {canReuseAddress && (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="reuseAddress"
                        checked={reuseAddress}
                        onCheckedChange={(checked) => setReuseAddress(checked === true)}
                      />
                      <Label htmlFor="reuseAddress" className="font-normal">
                        {t("register.form.reuseAddress")}
                      </Label>
                    </div>
                    {reuseAddress && firstAddress && (
                      <p className="text-muted-foreground text-sm" data-testid="reused-address">
                        {firstAddress.street}, {firstAddress.zipCode} {firstAddress.city}
                      </p>
                    )}
                  </div>
                )}

                {!(canReuseAddress && reuseAddress) && (
                  <>
                    <div className="grid gap-2">
                      <Label htmlFor="street">{t("register.form.street")}</Label>
                      <Input
                        id="street"
                        {...register("address.street")}
                        aria-invalid={!!errors.address?.street}
                      />
                      {errors.address?.street && (
                        <p className="text-destructive text-sm">
                          {t("register.errors.street")}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="zipCode">{t("register.form.zipCode")}</Label>
                        <Input
                          id="zipCode"
                          {...register("address.zipCode")}
                          aria-invalid={!!errors.address?.zipCode}
                        />
                        {errors.address?.zipCode && (
                          <p className="text-destructive text-sm">
                            {t("register.errors.zipCode")}
                          </p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="city">{t("register.form.city")}</Label>
                        <Input
                          id="city"
                          {...register("address.city")}
                          aria-invalid={!!errors.address?.city}
                        />
                        {errors.address?.city && (
                          <p className="text-destructive text-sm">
                            {t("register.errors.city")}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
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

                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold">{t("register.form.waiverTitle")}</p>
                  <div
                    data-testid="waiver-text"
                    className="text-muted-foreground max-h-32 overflow-y-auto rounded-md border p-3 text-xs leading-relaxed"
                  >
                    {t("register.form.waiverText")}
                  </div>
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
                onClick={() => void goToAddressStep()}
              >
                {t("register.form.next")}
              </Button>
            )}
            {formStep === "address" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormStep("contact")}
                >
                  {t("register.form.back")}
                </Button>
                <Button type="button" className="flex-1" onClick={() => void goToWeightStep()}>
                  {t("register.form.next")}
                </Button>
              </>
            )}
            {formStep === "weight" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormStep("address")}
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
