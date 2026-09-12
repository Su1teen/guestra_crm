import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { translations, type Language } from "@/i18n/translations";

export type { Language } from "@/i18n/translations";

export const LANGUAGE_STORAGE_KEY = "smart-crm-language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

interface LanguageProviderProps {
  children: ReactNode;
}

const isLanguage = (value: string | null): value is Language => value === "ru" || value === "en";

const getStoredLanguage = (): Language => {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : "ru";
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider = ({ children }: LanguageProviderProps) => {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    setLanguageState(lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "ru" ? "en" : "ru");
  }, [language, setLanguage]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dictionary = translations[language];
      let value = dictionary[key] ?? translations.ru[key] ?? key;
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(replacement));
        }
      }
      return value;
    },
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
};
