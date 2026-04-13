import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (password: string) => Promise<void>;
};

export function UnlockScreen({ onSubmit }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(password);
      setError(null);
    } catch {
      setError("Invalid password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Unlock Dashboard</h1>
      <p>Enter your password to open your local dashboard.</p>
      <form onSubmit={handleSubmit}>
        <input
          id="unlock-password"
          value={password}
          type="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={isSubmitting || !password.trim()}>
          {isSubmitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
          {isSubmitting ? "Logging in..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}
