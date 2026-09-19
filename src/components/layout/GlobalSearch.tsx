import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Search, Target, User } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCrm } from "@/store/crm-store";
import { formatStayRange, formatTenge } from "@/lib/format";

export const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { data, guestById, propertyName } = useCrm();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = (value?: string) => !!value && value.toLowerCase().includes(normalized);
    const guests = data.guests
      .filter((guest) => !normalized || matches(guest.fullName) || matches(guest.phone) || matches(guest.email))
      .slice(0, 6);
    const leads = data.leads
      .filter((lead) => {
        if (!normalized) return false;
        const guest = guestById(lead.guestId);
        return matches(lead.code) || matches(guest?.fullName) || matches(lead.roomType);
      })
      .slice(0, 6);
    const offers = data.offers
      .filter((offer) => {
        if (!normalized) return false;
        const guest = guestById(offer.guestId);
        return matches(offer.code) || matches(guest?.fullName);
      })
      .slice(0, 5);
    return { guests, leads, offers };
  }, [data.guests, data.leads, data.offers, guestById, query]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-brand-200 hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Поиск гостей, лидов, предложений</span>
        <kbd className="hidden rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Введите имя гостя, номер лида или предложения"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>Ничего не найдено. Уточните запрос.</CommandEmpty>
          {results.guests.length > 0 && (
            <CommandGroup heading="Гости">
              {results.guests.map((guest) => (
                <CommandItem key={guest.id} value={`guest-${guest.id}-${guest.fullName}`} onSelect={() => go(`/guests/${guest.id}`)}>
                  <User className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{guest.fullName}</span>
                  <span className="text-xs text-muted-foreground">{guest.phone}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.leads.length > 0 && (
            <CommandGroup heading="Лиды">
              {results.leads.map((lead) => (
                <CommandItem key={lead.id} value={`lead-${lead.id}-${lead.code}`} onSelect={() => go(`/leads/${lead.id}`)}>
                  <Target className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">
                    {lead.code} · {guestById(lead.guestId)?.fullName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {propertyName(lead.propertyId)} · {formatStayRange(lead.checkIn, lead.checkOut)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.offers.length > 0 && (
            <CommandGroup heading="Предложения">
              {results.offers.map((offer) => (
                <CommandItem key={offer.id} value={`offer-${offer.id}-${offer.code}`} onSelect={() => go(`/offers/${offer.id}`)}>
                  <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">
                    {offer.code} · {guestById(offer.guestId)?.fullName}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatTenge(offer.total)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
};
