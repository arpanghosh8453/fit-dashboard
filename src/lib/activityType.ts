import type { Activity } from "../types";

type ActivityMetadata = {
  sub_sport?: unknown;
  session?: {
    sub_sport?: unknown;
  };
};

const IGNORED_SUB_SPORTS = new Set(["generic", "all", "unknown", "invalid"]);

const CYCLING_SUB_SPORT_LABELS: Record<string, string> = {
  indoor_cycling: "Indoor Cycling",
  spin: "Indoor Cycling",
  mountain: "Mountain Biking",
  mountain_biking: "Mountain Biking",
};

function titleCaseWords(value: string): string {
  return value
    .trim()
    .split(/[\s_/-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function titleCaseSport(sport?: string | null): string {
  const trimmed = sport?.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return "Activity";
  return titleCaseWords(trimmed) || "Activity";
}

function metadataSubSport(raw?: string): string | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ActivityMetadata | null;
    if (!parsed || typeof parsed !== "object") return null;

    const value =
      typeof parsed.sub_sport === "string"
        ? parsed.sub_sport
        : typeof parsed.session?.sub_sport === "string"
          ? parsed.session.sub_sport
          : null;

    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function formatActivityType(sport?: string | null, subSport?: string | null): string {
  const sportLabel = titleCaseSport(sport);
  const trimmedSubSport = subSport?.trim();
  if (!trimmedSubSport) return sportLabel;

  const subSportLower = trimmedSubSport.toLowerCase();
  if (IGNORED_SUB_SPORTS.has(subSportLower)) return sportLabel;

  const sportLower = sport?.trim().toLowerCase() ?? "";
  if (sportLower === "cycling" && CYCLING_SUB_SPORT_LABELS[subSportLower]) {
    return CYCLING_SUB_SPORT_LABELS[subSportLower];
  }

  const subSportLabel = titleCaseWords(trimmedSubSport);
  if (!subSportLabel) return sportLabel;

  if (sportLabel === "Activity" || (sportLower && subSportLower.includes(sportLower))) {
    return subSportLabel;
  }

  return `${subSportLabel} ${sportLabel}`;
}

export function formatActivityTypeLabel(activity: Pick<Activity, "sport" | "metadata_json">): string {
  return formatActivityType(activity.sport, metadataSubSport(activity.metadata_json));
}
