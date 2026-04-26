type Props = {
  supporterBadge: boolean;
  dismissed: boolean;
  onDismiss: () => void;
};

export function DonationBanner({ supporterBadge, dismissed, onDismiss }: Props) {
  if (supporterBadge || dismissed) return null;

  return (
    <div className="donation-banner" role="region" aria-label="Supporter banner" style={{ textAlign: "center" }}>
      <div className="donation-banner-content">
        <span className="donation-banner-text donation-banner-text--full">
          No subscriptions. No advertisements. You are in control of your data. Support us and get your
        </span>
        <span className="donation-banner-text donation-banner-text--compact">
          Get your
        </span>
        {" "}
        <a
          className="donation-banner-link"
          href="https://ko-fi.com/s/ec2c3036ee"
          target="_blank"
          rel="noreferrer"
        >
          supporter badge
        </a>
        {" "}
        <span className="donation-banner-text">today</span>
      </div>
      <button className="donation-banner-dismiss" onClick={onDismiss} title="Dismiss banner" aria-label="Dismiss banner">
        ×
      </button>
    </div>
  );
}
