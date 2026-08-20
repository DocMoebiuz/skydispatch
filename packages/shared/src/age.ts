// Age as of today, from a "YYYY-MM-DD" date of birth — used both to gate the
// guardian-consent requirement (guestCreateRequestSchema) and to decide
// whether RegisterPage even shows that checkbox, so the two can't drift.
export const MINOR_AGE_THRESHOLD = 18;

export function ageFromDateOfBirth(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export function isMinor(dateOfBirth: string): boolean {
  return ageFromDateOfBirth(dateOfBirth) < MINOR_AGE_THRESHOLD;
}
