import { z } from "zod";

// Password rule per spec: at least 10 chars, one digit, one symbol.
const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/\d/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one symbol");

const email = z.string().email("Enter a valid email address");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  email,
  password,
});
export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
