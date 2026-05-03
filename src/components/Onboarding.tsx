import { FormEvent, useState } from "react";
import { useTranslation } from "../lib/i18n";

type Props = {
  onSubmit: (username: string, password: string) => Promise<void>;
};

export function Onboarding({ onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    if (!username.trim()) {
      setError(t("onboarding.usernameRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t("onboarding.passwordMinLength"));
      return;
    }
    if (password !== verifyPassword) {
      setError(t("onboarding.passwordMismatch"));
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(username, password);
    } catch {
      setError(t("onboarding.createFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>{t("onboarding.welcome")}</h1>
      <p>{t("onboarding.subtitle")}</p>
      <form onSubmit={handleSubmit}>
        <input
          id="onboarding-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("onboarding.usernamePlaceholder")}
          autoComplete="username"
        />
        <input
          id="onboarding-password"
          value={password}
          type="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("onboarding.passwordPlaceholder")}
          autoComplete="new-password"
        />
        <input
          id="onboarding-verify"
          value={verifyPassword}
          type="password"
          onChange={(e) => setVerifyPassword(e.target.value)}
          placeholder={t("onboarding.verifyPasswordPlaceholder")}
          autoComplete="new-password"
        />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={isSubmitting || !username.trim() || !password || !verifyPassword}>
          {isSubmitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
          {isSubmitting ? t("onboarding.creating") : t("onboarding.createAccount")}
        </button>
      </form>
    </div>
  );
}
