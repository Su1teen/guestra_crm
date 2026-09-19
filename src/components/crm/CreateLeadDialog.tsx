import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, ChevronRight, ChevronLeft, Check } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCrm } from "@/store/crm-store";
import { directionLabels } from "@/lib/labels";
import type { Guest } from "@/types/crm";

const DIRECTIONS = ["accommodation", "restaurant", "spa", "massage", "sauna", "karaoke", "activities", "transfer", "corporate", "wedding", "other"];

export const CreateLeadDialog = () => {
  const navigate = useNavigate();
  const { data, createLead } = useCrm();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);

  // Step 1
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestForm, setGuestForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    company: "",
    language: "Русский",
    source: "email",
    propertyId: data.properties[0]?.id || "",
  });

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return data.guests.filter((g) => 
      g.fullName.toLowerCase().includes(query) || 
      g.phone.includes(query) || 
      g.email.toLowerCase().includes(query)
    ).slice(0, 5);
  }, [searchQuery, data.guests]);

  // Step 2
  const [interests, setInterests] = useState<string[]>([]);
  const [primaryInterest, setPrimaryInterest] = useState<string>("");

  // Step 3
  const [detailsForm, setDetailsForm] = useState<Record<string, any>>({});

  // Step 4
  const [crmForm, setCrmForm] = useState({
    stage: "new",
    ownerId: data.employees[0]?.id || "",
    note: "",
  });

  const handleNext = () => setStep((s) => s + 1);
  const handleBack = () => setStep((s) => s - 1);

  const handleSubmit = async () => {
    // Collect data
    const input: any = {
      propertyId: guestForm.propertyId,
      source: guestForm.source,
      stage: crmForm.stage,
      primaryDirection: primaryInterest || interests[0] || "other",
      directions: interests,
      interests: interests.map(dir => ({ direction: dir, isPrimary: dir === primaryInterest })),
      ownerId: crmForm.ownerId,
      note: crmForm.note,
    };

    if (selectedGuest) {
      input.guestId = selectedGuest.id;
    } else {
      input.guest = {
        fullName: guestForm.fullName,
        phone: guestForm.phone,
        email: guestForm.email,
        company: guestForm.company,
        language: guestForm.language,
      };
    }

    const items: any[] = [];
    if (interests.includes("accommodation")) {
      items.push({
        type: "accommodation",
        name: detailsForm.roomType || "Проживание",
        roomType: detailsForm.roomType,
        startAt: detailsForm.checkIn ? new Date(`${detailsForm.checkIn}T15:00:00`).toISOString() : undefined,
        endAt: detailsForm.checkOut ? new Date(`${detailsForm.checkOut}T12:00:00`).toISOString() : undefined,
        adults: detailsForm.adults ? Number(detailsForm.adults) : undefined,
        children: detailsForm.children ? Number(detailsForm.children) : undefined,
      });
    }
    // Simple push for others
    ["restaurant", "spa", "massage", "activities"].forEach(dir => {
      if (interests.includes(dir)) {
        items.push({
          type: "service",
          name: directionLabels[dir as keyof typeof directionLabels],
          startAt: detailsForm[`${dir}_date`] ? new Date(detailsForm[`${dir}_date`]).toISOString() : undefined,
          participants: detailsForm[`${dir}_guests`] ? Number(detailsForm[`${dir}_guests`]) : undefined,
        });
      }
    });
    input.items = items;

    const lead = await createLead(input);
    setOpen(false);
    navigate(`/leads/${lead.id}`);
  };

  const resetState = () => {
    setStep(1);
    setSearchQuery("");
    setSelectedGuest(null);
    setGuestForm({ ...guestForm, fullName: "", phone: "", email: "", company: "" });
    setInterests([]);
    setPrimaryInterest("");
    setDetailsForm({});
    setCrmForm({ ...crmForm, note: "" });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) resetState(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Добавить лида
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новое обращение (Шаг {step} из 4)</DialogTitle>
          <DialogDescription>
            {step === 1 && "Укажите данные гостя и источник"}
            {step === 2 && "Выберите интересующие направления"}
            {step === 3 && "Уточните детали запроса"}
            {step === 4 && "Настройте параметры сделки"}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Поиск существующего гостя</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Телефон, email или имя" 
                    className="pl-9" 
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSelectedGuest(null); }}
                  />
                </div>
                {searchResults.length > 0 && !selectedGuest && (
                  <div className="rounded-md border bg-card p-2 shadow-sm space-y-1">
                    {searchResults.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-secondary text-left"
                        onClick={() => { setSelectedGuest(g); setSearchQuery(""); }}
                      >
                        <span>{g.fullName}</span>
                        <span className="text-xs text-muted-foreground">{g.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedGuest && (
                  <div className="flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 p-2 text-sm">
                    <span>Выбран: <strong>{selectedGuest.fullName}</strong> ({selectedGuest.phone})</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedGuest(null)}>Сбросить</Button>
                  </div>
                )}
              </div>
              
              {!selectedGuest && (
                <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>ФИО гостя *</Label>
                    <Input value={guestForm.fullName} onChange={(e) => setGuestForm({ ...guestForm, fullName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Телефон</Label>
                    <Input value={guestForm.phone} onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={guestForm.email} onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })} />
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
                <div className="space-y-1.5">
                  <Label>Объект</Label>
                  <Select value={guestForm.propertyId} onValueChange={(v) => setGuestForm({ ...guestForm, propertyId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {data.properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Источник</Label>
                  <Select value={guestForm.source} onValueChange={(v) => setGuestForm({ ...guestForm, source: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="walk_in">Визит</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="phone">Телефон</SelectItem>
                      <SelectItem value="booking">Booking.com</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Label>Выберите направления (можно несколько)</Label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {DIRECTIONS.map(dir => (
                  <div key={dir} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`dir-${dir}`} 
                      checked={interests.includes(dir)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setInterests([...interests, dir]);
                          if (!primaryInterest) setPrimaryInterest(dir);
                        } else {
                          setInterests(interests.filter(i => i !== dir));
                          if (primaryInterest === dir) setPrimaryInterest(interests.filter(i => i !== dir)[0] || "");
                        }
                      }}
                    />
                    <label htmlFor={`dir-${dir}`} className="text-sm font-medium leading-none cursor-pointer">
                      {directionLabels[dir as keyof typeof directionLabels] || dir}
                    </label>
                  </div>
                ))}
              </div>

              {interests.length > 1 && (
                <div className="pt-4 border-t space-y-2">
                  <Label>Основное направление</Label>
                  <RadioGroup value={primaryInterest} onValueChange={setPrimaryInterest} className="flex flex-wrap gap-4">
                    {interests.map(dir => (
                      <div key={`primary-${dir}`} className="flex items-center space-x-2">
                        <RadioGroupItem value={dir} id={`primary-${dir}`} />
                        <label htmlFor={`primary-${dir}`} className="text-sm cursor-pointer">
                          {directionLabels[dir as keyof typeof directionLabels] || dir}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 max-h-[50vh] overflow-y-auto pr-2">
              {interests.includes("accommodation") && (
                <div className="space-y-3 rounded-lg border p-3">
                  <h4 className="font-medium text-sm">Проживание</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Заезд</Label>
                      <Input type="date" value={detailsForm.checkIn || ""} onChange={e => setDetailsForm({ ...detailsForm, checkIn: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Выезд</Label>
                      <Input type="date" value={detailsForm.checkOut || ""} onChange={e => setDetailsForm({ ...detailsForm, checkOut: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Взрослые</Label>
                      <Input type="number" min={1} value={detailsForm.adults || ""} onChange={e => setDetailsForm({ ...detailsForm, adults: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Дети</Label>
                      <Input type="number" min={0} value={detailsForm.children || ""} onChange={e => setDetailsForm({ ...detailsForm, children: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
              
              {["restaurant", "spa", "massage", "activities"].map(dir => interests.includes(dir) && (
                <div key={dir} className="space-y-3 rounded-lg border p-3">
                  <h4 className="font-medium text-sm">{directionLabels[dir as keyof typeof directionLabels]}</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Дата</Label>
                      <Input type="date" value={detailsForm[`${dir}_date`] || ""} onChange={e => setDetailsForm({ ...detailsForm, [`${dir}_date`]: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Гостей / Участников</Label>
                      <Input type="number" min={1} value={detailsForm[`${dir}_guests`] || ""} onChange={e => setDetailsForm({ ...detailsForm, [`${dir}_guests`]: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}

              {interests.length === 0 && (
                <p className="text-sm text-muted-foreground">Направления не выбраны, детали не требуются.</p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Начальная стадия</Label>
                  <Select value={crmForm.stage} onValueChange={(v) => setCrmForm({ ...crmForm, stage: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Новый лид</SelectItem>
                      <SelectItem value="qualified">Квалифицирован</SelectItem>
                      <SelectItem value="planning">Комплектация</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Ответственный</Label>
                  <Select value={crmForm.ownerId} onValueChange={(v) => setCrmForm({ ...crmForm, ownerId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {data.employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Заметка менеджера</Label>
                <Textarea 
                  rows={3} 
                  placeholder="Дополнительные детали..."
                  value={crmForm.note}
                  onChange={(e) => setCrmForm({ ...crmForm, note: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
          {step > 1 ? (
            <Button variant="outline" onClick={handleBack} className="gap-2">
              <ChevronLeft className="h-4 w-4" /> Назад
            </Button>
          ) : (
            <div /> // Spacer
          )}
          
          {step < 4 ? (
            <Button onClick={handleNext} disabled={step === 1 && !selectedGuest && !guestForm.fullName.trim()} className="gap-2">
              Далее <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} className="gap-2">
              <Check className="h-4 w-4" /> Создать
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
