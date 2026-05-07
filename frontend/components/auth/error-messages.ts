// Map Firebase auth error codes to user-friendly messages. Anything not
// listed falls back to a generic message — never expose Firebase's raw
// codes or internal details to the user.

export function humanizeAuthError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "That email is already registered. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 10 characters with a number and a symbol.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/email-not-verified":
      return "Please verify your email before signing in. Check your inbox.";
    case "auth/user-disabled":
      return "This account has been disabled. If you think this is a mistake, you can submit an appeal.";
    default:
      return "Something went wrong. Please try again.";
  }
}
