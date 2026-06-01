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

const CYCLING_SUB_SPORT_ALIASES: Record<string, string> = {
  spin: "indoor_cycling",
  mountain_biking: "mountain",
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

function normalizedSport(sport?: string | null): string | null {
  const trimmed = sport?.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown") return null;
  return trimmed;
}

function titleCaseSport(sport?: string | null): string {
  const sportKey = normalizedSport(sport);
  if (!sportKey) return "Activity";
  return titleCaseWords(sportKey) || "Activity";
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

function normalizedSubSport(sport?: string | null, subSport?: string | null): string | null {
  const trimmedSubSport = subSport?.trim().toLowerCase();
  if (!trimmedSubSport || IGNORED_SUB_SPORTS.has(trimmedSubSport)) return null;

  const sportKey = normalizedSport(sport);
  if (sportKey === "cycling") {
    return CYCLING_SUB_SPORT_ALIASES[trimmedSubSport] ?? trimmedSubSport;
  }

  return trimmedSubSport;
}

export function formatActivityType(sport?: string | null, subSport?: string | null): string {
  const sportLabel = titleCaseSport(sport);
  const subSportKey = normalizedSubSport(sport, subSport);
  if (!subSportKey) return sportLabel;

  const sportKey = normalizedSport(sport) ?? "";
  if (sportKey === "cycling" && CYCLING_SUB_SPORT_LABELS[subSportKey]) {
    return CYCLING_SUB_SPORT_LABELS[subSportKey];
  }

  const subSportLabel = titleCaseWords(subSportKey);
  if (!subSportLabel) return sportLabel;

  if (sportLabel === "Activity" || (sportKey && subSportKey.includes(sportKey))) {
    return subSportLabel;
  }

  return `${subSportLabel} ${sportLabel}`;
}

export function formatActivityTypeLabel(activity: Pick<Activity, "sport" | "metadata_json">): string {
  return formatActivityType(activity.sport, metadataSubSport(activity.metadata_json));
}

export function formatSportLabel(sport?: string | null): string {
  return titleCaseSport(sport);
}

export function getSportFilterValue(sport?: string | null): string | null {
  const sportKey = normalizedSport(sport);
  return sportKey ? `sport:${sportKey}` : null;
}

export function getActivitySportFilterValue(activity: Pick<Activity, "sport">): string | null {
  return getSportFilterValue(activity.sport);
}

export function getActivityTypeFilterValue(activity: Pick<Activity, "sport" | "metadata_json">): string | null {
  const sportKey = normalizedSport(activity.sport);
  const subSportKey = normalizedSubSport(activity.sport, metadataSubSport(activity.metadata_json));
  if (!sportKey || !subSportKey) return null;
  return `type:${sportKey}:${subSportKey}`;
}

export function activityMatchesTypeFilter(
  activity: Pick<Activity, "sport" | "metadata_json">,
  filterValue: string,
): boolean {
  if (filterValue === "all") return true;

  if (filterValue.startsWith("sport:")) {
    return getActivitySportFilterValue(activity) === filterValue;
  }

  if (filterValue.startsWith("type:")) {
    return getActivityTypeFilterValue(activity) === filterValue;
  }

  return activity.sport === filterValue;
}
