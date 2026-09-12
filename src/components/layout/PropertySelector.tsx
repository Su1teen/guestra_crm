import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { properties } from "@/data/reference";
import { useCrm, type PropertyFilter } from "@/store/crm-store";

export const PropertySelector = () => {
  const { property, setProperty } = useCrm();

  return (
    <Select value={property} onValueChange={(value) => setProperty(value as PropertyFilter)}>
      <SelectTrigger className="h-9 w-[210px] rounded-xl border-border bg-card text-sm" aria-label="Объект">
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все объекты ЛЕС</SelectItem>
        {properties.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
