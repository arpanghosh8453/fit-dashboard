import { openExternalLink } from "../lib/links";
import { useTranslation } from "../lib/i18n";

type Props = {
  supporterBadge: boolean;
  dismissed: boolean;
  onDismiss: () => void;
};

export function DonationBanner({ supporterBadge, dismissed, onDismiss }: Props) {
  const { t } = useTranslation();
  if (supporterBadge || dismissed) return null;

  return (
    <div className="donation-banner" role="region" aria-label="Supporter banner" style={{ textAlign: "center" }}>
      <div className="donation-banner-content">
        <span className="donation-banner-text donation-banner-text--full">
          {t("donation.noSubscriptions")}
        </span>
        {" "}
        <span className="donation-banner-text">
          {t("donation.supportOn")}{" "}
          <a
            className="donation-banner-text-link"
            href="https://ko-fi.com/arpandesign"
            target="_blank"
            rel="noreferrer"
            onClick={openExternalLink}
          >
            Ko-Fi
          </a>
          {" "}{t("donation.orGetYour")}
        </span>
        {" "}
        <a
          className="donation-banner-link"
          href="https://ko-fi.com/s/ec2c3036ee"
          target="_blank"
          rel="noreferrer"
          onClick={openExternalLink}
        >
          {t("donation.supporterBadge")}
        </a>
      </div>
      <button className="donation-banner-dismiss" onClick={onDismiss} title={t("donation.dismissBanner")} aria-label={t("donation.dismissBanner")}>
        ×
      </button>
    </div>
  );
}

