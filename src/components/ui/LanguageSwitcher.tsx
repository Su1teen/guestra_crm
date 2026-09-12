import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface LanguageSwitcherProps {
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "icon";
  className?: string;
  showIcon?: boolean;
}

/**
 * Compact RU/EN toggle. Renders the language you will switch TO.
 */
export const LanguageSwitcher = ({
  variant = "outline",
  size = "sm",
  className,
  showIcon = true,
}: LanguageSwitcherProps) => {
  const { language, toggleLanguage } = useLanguage();
  const nextLabel = language === "ru" ? "EN" : "RU";

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={toggleLanguage}
      className={className}
      aria-label={`Switch language to ${nextLabel}`}
      title={nextLabel}
    >
      {showIcon && <Languages className="h-4 w-4" />}
      <span>{nextLabel}</span>
    </Button>
  );
};

export default LanguageSwitcher;
