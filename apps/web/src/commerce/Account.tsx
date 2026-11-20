import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  login,
  register,
  forgotPassword,
  manageAccount,
  verifyEmail,
  logout,
  useSession,
} from "../auth/session";
import { safeReturnPath } from "../auth/access";
export function SignIn({ registration = false }: { registration?: boolean }) {
  const session = useSession();
  const [opening, setOpening] = useState<"account" | "recovery">();
  const [query] = useSearchParams();
  async function start(action: "account" | "recovery") {
    setOpening(action);
    try {
      if (action === "recovery") await forgotPassword();
      else if (registration) await register(returnTo);
      else await login(returnTo);
    } finally {
      setOpening(undefined);
    }
  }
  const returnTo = safeReturnPath(query.get("returnTo") ?? (registration ? "/account" : "/"));
  if (!session.ready)
    return (
      <p className="panel empty-state" role="status">
        Checking your session…
      </p>
    );
  if (session.authenticated)
    return (
      <section className="panel auth-card">
        <h1>You’re signed in</h1>
        <p>Continue shopping or manage your account.</p>
        <Link className="button-link" to={returnTo}>
          Continue
        </Link>{" "}
        <Link to="/account">My account</Link>
      </section>
    );
  return (
    <section className="panel auth-card">
      <span className="eyebrow">YOUR COMMERCE ACCOUNT</span>
      <h1>{registration ? "Make yourself at home" : "Welcome back"}</h1>
      <p>
        {registration
          ? "Create an account to checkout and follow your orders."
          : "Sign in to continue shopping and see your orders."}
      </p>
      <p className="muted">
        You’ll continue to our secure account provider. Your password stays there.
      </p>
      <button
        disabled={session.unavailable || !!opening}
        onClick={() => void start("account")}
      >
        {opening === "account" ? "Opening secure sign-in…" : registration ? "Create account" : "Sign in"}
      </button>
      <p>
        {registration ? (
          <>
            Already have an account? <Link to="/login">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link to="/register">Create an account</Link>
          </>
        )}
      </p>
      <details>
        <summary>Forgot your password?</summary>
        <p>Continue to secure sign-in, then choose “Forgot password?” to request a reset email.</p>
        <button
          className="subtle"
          disabled={session.unavailable || !!opening}
          onClick={() => void start("recovery")}
        >
          {opening === "recovery" ? "Opening password recovery…" : "Continue to password recovery"}
        </button>
      </details>
    </section>
  );
}
export function Account() {
  const session = useSession();
  const [openingVerification, setOpeningVerification] = useState(false);
  async function openVerification() {
    setOpeningVerification(true);
    try {
      await verifyEmail();
    } finally {
      setOpeningVerification(false);
    }
  }
  return (
    <section className="panel account-page">
      <span className="eyebrow">YOUR ACCOUNT</span>
      <h1>Hello{session.firstName ? `, ${session.firstName}` : ""}.</h1>
      <p className="muted">Keep your details and account security up to date.</p>
      <dl className="profile-details">
        <dt>Name</dt>
        <dd>
          {[session.firstName, session.lastName].filter(Boolean).join(" ") ||
            session.username ||
            "Not provided"}
        </dd>
        <dt>Email</dt>
        <dd>{session.email || "Not provided"}</dd>
        <dt>Email verification</dt>
        <dd>
          {session.emailVerified === true
            ? "Verified"
            : session.emailVerified === false
              ? "Not verified"
              : "Verification status unavailable"}
        </dd>
      </dl>
      {session.email && session.emailVerified === false && (
        <div className="notice">
          <p>Open the secure verification page to request an email or resend a missing link.</p>
          <button className="subtle" disabled={openingVerification} onClick={() => void openVerification()}>
            {openingVerification ? "Opening email verification…" : "Verify email"}
          </button>
        </div>
      )}
      <div className="actions">
        <button onClick={() => void manageAccount()}>Manage profile & security</button>
        <Link className="button-link subtle" to="/orders">
          My orders
        </Link>
        <Link className="button-link subtle" to="/notifications">
          Notifications
        </Link>
        <button className="subtle" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </section>
  );
}
