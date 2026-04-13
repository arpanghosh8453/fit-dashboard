import { useState } from "react";

type Props = {
  supporterBadge: boolean;
  donationDismissed: boolean;
  onDismiss: () => void;
  onActivate: (code: string) => Promise<boolean> | boolean;
};

export function DonationBanner({ supporterBadge, donationDismissed, onDismiss, onActivate }: Props) {
  const [codeInput, setCodeInput] = useState("");
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Don't show anything if supporter badge is active or banner was dismissed
  if (supporterBadge || donationDismissed) return null;

  async function handleVerify() {
    if (!codeInput.trim()) return;
    setVerifying(true);
    setErrorMsg("");
    const success = await onActivate(codeInput);
    setVerifying(false);
    if (!success) {
      setErrorMsg("Invalid code. Please try again.");
    }
  }

  return (
    <div className="donation-banner">
      <div>
        <strong>Keep this project sustainable</strong>
        <span>Support development by entering your supporter code.</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {showCodeInput ? (
          <>
            <input
              type="text"
              placeholder="Enter code..."
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              style={{ width: "160px", fontSize: "13px" }}
            />
            <button className="btn-primary" onClick={handleVerify} disabled={verifying || !codeInput.trim()}>
              {verifying ? "..." : "Activate"}
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={() => setShowCodeInput(true)}>
            Enter Code
          </button>
        )}
        <button className="btn-outline-secondary" onClick={onDismiss} title="Dismiss">✕</button>
      </div>
      {errorMsg && <span style={{ color: "var(--danger)", fontSize: "12px", marginTop: "4px" }}>{errorMsg}</span>}
    </div>
  );
}
