type Props = {
  supporterBadge: boolean;
  onBuyBadge: () => void;
};

export function DonationBanner({ supporterBadge, onBuyBadge }: Props) {
  if (supporterBadge) {
    return (
      <div className="donation-banner supporter">
        <div>
          <strong>Supporter Badge Active</strong>
          <span>Thank you for supporting FIT Dashboard.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="donation-banner">
      <div>
        <strong>Keep this project sustainable</strong>
        <span>One-time support unlocks your in-app supporter badge.</span>
      </div>
      <button className="btn-primary" onClick={onBuyBadge}>Buy Supporter Badge</button>
    </div>
  );
}
