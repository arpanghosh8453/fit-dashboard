import { useSettingsStore } from "../stores/settingsStore";

import en from "../i18n/en.json";
import de from "../i18n/de.json";
import es from "../i18n/es.json";
import fr from "../i18n/fr.json";
import hu from "../i18n/hu.json";
import it from "../i18n/it.json";
import nl from "../i18n/nl.json";
import pl from "../i18n/pl.json";
import pt from "../i18n/pt.json";
import tr from "../i18n/tr.json";
import zh from "../i18n/zh.json";
import ja from "../i18n/ja.json";
import ko from "../i18n/ko.json";

type TranslationMap = Record<string, string>;

const locales: Record<string, TranslationMap> = {
  en, de, es, fr, hu, it, nl, pl, pt, tr, zh, ja, ko,
};

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "hu", label: "Magyar" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "pt", label: "Português" },
  { code: "tr", label: "Türkçe" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

/**
 * Translate a key, with optional interpolation.
 * Usage: t("sidebar.logsSelected", { filtered: 5, total: 10 })
 */
function translate(lang: string, key: string, params?: Record<string, string | number>): string {
  const map = locales[lang] ?? en;
  let text = map[key] ?? en[key as keyof typeof en] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/**
 * React hook that returns a bound `t` function using the current language.
 */
export function useTranslation() {
  const language = useSettingsStore((s) => s.language);
  const t = (key: string, params?: Record<string, string | number>): string =>
    translate(language, key, params);
  return { t, language };
}
