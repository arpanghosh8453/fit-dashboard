import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (username: string, password: string) => Promise<void>;
};

export function Onboarding({ onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== verifyPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    await onSubmit(username, password);
  }

  return (
    <div className="auth-card">
      <h1>Welcome to FIT Dashboard</h1>
      <p>Create your local account to secure your data.</p>
      <form onSubmit={handleSubmit}>
        <input
          id="onboarding-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <input
          id="onboarding-password"
          value={password}
          type="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="new-password"
        />
        <input
          id="onboarding-verify"
          value={verifyPassword}
          type="password"
          onChange={(e) => setVerifyPassword(e.target.value)}
          placeholder="Verify password"
          autoComplete="new-password"
        />
        {error && <div className="error">{error}</div>}
        <button type="submit">Create Account</button>
      </form>
    </div>
  );
}
