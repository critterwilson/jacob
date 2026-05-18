import { z } from "zod";

// Password rule per spec: at least 10 chars, one digit, one symbol.
const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/\d/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one symbol");

const email = z.string().email("Enter a valid email address");

export const MIN_AGE = 13;

/**
 * Whole-year age on `today`. Mirrors the backend's `compute_age` in
 * `services/applications.py` so the client-side under-13 gate and the
 * server's authoritative check stay in agreement on leap-day edge cases.
 */
export function computeAge(dob: Date, today: Date = new Date()): number {
  let years = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    years -= 1;
  }
  return years;
}

export const dobSchema = z
  .string()
  .min(1, "Date of birth is required")
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), {
    error: "Use YYYY-MM-DD",
  })
  .refine(
    (value) => {
      const dob = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(dob.getTime())) return false;
      return dob.getTime() <= Date.now();
    },
    { error: "Date of birth can't be in the future" },
  )
  .refine(
    (value) => {
      const dob = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(dob.getTime())) return false;
      return computeAge(dob) >= MIN_AGE;
    },
    { error: `JACOB requires you to be at least ${MIN_AGE}` },
  );

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  email,
  password,
  // Collected at signup so under-13 is caught before we create the
  // Firebase Auth user. The authoritative copy lives on the application
  // doc (set from the onboarding form). See ADR 0012 § 6.
  dob: dobSchema,
  acceptTerms: z.literal(true, {
    error: "You must agree to the Terms of Service and Privacy Policy",
  }),
});
export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
