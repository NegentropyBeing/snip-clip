import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import ptBR from "./pt-BR";

/** Follows the system language (FR-34): Portuguese variants get pt-BR, everything else English. */
export function systemLanguage(): "en" | "pt-BR" {
  return navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, "pt-BR": { translation: ptBR } },
  lng: systemLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
