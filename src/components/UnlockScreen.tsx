import { FormEvent, useState } from "react";
import { useTranslation } from "../lib/i18n";

type Props = {
  onSubmit: (password: string) => Promise<void>;
};

export function UnlockScreen({ onSubmit }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(password);
      setError(null);
    } catch {
      setError(t("unlock.invalidPassword"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>{t("unlock.title")}</h1>
      <p>{t("unlock.subtitle")}</p>
      <form onSubmit={handleSubmit}>
        <input
          id="unlock-password"
          value={password}
          type="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("unlock.passwordPlaceholder")}
          autoComplete="current-password"
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={isSubmitting || !password.trim()}>
          {isSubmitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
          {isSubmitting ? t("unlock.loggingIn") : t("unlock.unlock")}
        </button>
      </form>
    </div>
  );
}
