import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { sourceLabels } from "@/lib/labels";
import { SERVICE_GROUPS } from "@shared/service-groups";
import type { Guest, InterestDirection, LeadSource } from "@/types/crm";

const SOURCES: LeadSource[] = [
  "whatsapp",
  "telegram",
  "phone",
  "website",
  "instagram",
  "email",
  "walk_in",
  "returning",
  "corporate",
  "referral",
];

/** Коммерческие категории услуг для выбора на создании (без transfer и служебных). */
const CATEGORY_OPTIONS = SERVICE_GROUPS.filter((group) => group.code !== "other");

export const CreateLeadDialog = () => {
  const navigate = useNavigate();
  const { data, createLead, currentEmployee } = useCrm();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestForm, setGuestForm] = useState({ fullName: "", phone: "", email: "", company: "" });
  const [propertyId, setPropertyId] = useState<string>(data.properties[0]?.id || "");
  const [source, setSource] = useState<LeadSource>("whatsapp");
  const [ownerId, setOwnerId] = useState<string>(currentEmployee.id);
  const [categories, setCategories] = useState<InterestDirection[]>([]);
  const [requestText, setRequestText] = useState("");

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return data.guests
      .filter(
        (guest) =>
          guest.fullName.toLowerCase().includes(query) ||
          guest.phone?.toLowerCase().includes(query) ||
          guest.email?.toLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [searchQuery, data.guests]);

  const toggleCategory = (direction: InterestDirection) => {
    setCategories((current) =>
      current.includes(direction) ? current.filter((item) => item !== direction) : [...current, direction],
    );
  };

  const canSubmit = Boolean(selectedGuest || guestForm.fullName.trim()) && Boolean(propertyId) && !submitting;

  const resetState = () => {
    setSearchQuery("");
    setSelectedGuest(null);
    setGuestForm({ fullName: "", phone: "", email: "", company: "" });
    setCategories([]);
    setRequestText("");
    setError(null);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const lead = await createLead({
        guestId: selectedGuest?.id,
        guest: selectedGuest
          ? undefined
          : {
              fullName: guestForm.fullName.trim(),
              phone: guestForm.phone || undefined,
              email: guestForm.email || undefined,
              company: guestForm.company || undefined,
            },
        propertyId,
        source,
        ownerId,
        serviceCategories: categories.length ? categories : undefined,
        requestText: requestText.trim() || undefined,
      });
      setOpen(false);
      resetState();
      navigate(`/leads/${lead.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать обращение");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) resetState(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Новое обращение
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое обращение</DialogTitle>
          <DialogDescription>
            Достаточно гостя, объекта и источника — детали и услуги собираются на следующих этапах.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Гость *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Телефон, email или имя"
                className="pl-9"
                value={searchQuery}
                onChange={(event) => { setSearchQuery(event.target.value); setSelectedGuest(null); }}
              />
            </div>
            {searchResults.length > 0 && !selectedGuest && (
              <div className="rounded-md border bg-card p-2 shadow-sm space-y-1">
                {searchResults.map((guest) => (
                  <button
                    key={guest.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-secondary text-left"
                    onClick={() => { setSelectedGuest(guest); setSearchQuery(""); }}
                  >
                    <span>{guest.fullName}</span>
                    <span className="text-xs text-muted-foreground">{guest.phone}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedGuest ? (
              <div className="flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 p-2 text-sm">
                <span>
                  Выбран: <strong>{selectedGuest.fullName}</strong> ({selectedGuest.phone ?? "без телефона"})
                </span>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedGuest(null)}>
                  Сбросить
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">ФИО нового гостя *</Label>
                  <Input value={guestForm.fullName} onChange={(event) => setGuestForm({ ...guestForm, fullName: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Телефон</Label>
                  <Input value={guestForm.phone} onChange={(event) => setGuestForm({ ...guestForm, phone: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={guestForm.email} onChange={(event) => setGuestForm({ ...guestForm, email: event.target.value })} />
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Объект *</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Источник *</Label>
              <Select value={source} onValueChange={(value) => setSource(value as LeadSource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((item) => (
                    <SelectItem key={item} value={item}>{sourceLabels[item]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Ответственный</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Категории услуг <span className="text-muted-foreground font-normal">(можно уточнить позже)</span></Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((group) => {
                const active = categories.includes(group.direction as InterestDirection);
                return (
                  <button
                    key={group.code}
                    type="button"
                    onClick={() => toggleCategory(group.direction as InterestDirection)}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-border bg-background text-muted-foreground hover:border-brand-300"
                    }`}
                  >
                    {group.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Запрос гостя</Label>
            <Textarea
              rows={3}
              placeholder="Коротко: что просит клиент, даты, пожелания…"
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
            />
          </div>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Создать обращение
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
