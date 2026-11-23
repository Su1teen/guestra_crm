import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatTemplate {
  id: string; key: string; title: string; category: string; action: "offer" | "payment_request" | null;
  text: string; missing: string[]; hasMetaTemplate: boolean;
}

const VARIABLE_LABELS: Record<string, string> = {
  guest_first_name: "имя гостя", guest_name: "ФИО гостя", property_name: "объект", booking_code: "номер брони",
  arrival_date: "дата заезда", departure_date: "дата выезда", room_type: "категория", offer: "предмет предложения",
  total_amount: "сумма", deposit_amount: "предоплата", manager_name: "менеджер",
};

/**
 * Every template the AI can send, available to a person with one click: pick, check or edit the
 * filled text, send. Templates bound to a CRM action (offer, payment request) open that action.
 */
export const TemplatePicker = ({ conversationId, disabled, onAction, onSent }: {
  conversationId: string; disabled?: boolean; onAction: (action: "offer" | "payment_request") => void; onSent: () => void;
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ windowOpen: boolean; channel: string; templates: ChatTemplate[] } | null>(null);
  const [chosen, setChosen] = useState<ChatTemplate | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    apiRequest<{ windowOpen: boolean; channel: string; templates: ChatTemplate[] }>(`/api/crm/conversations/${conversationId}/templates`)
      .then(setState).catch((error) => toast({ title: "Не удалось загрузить шаблоны", description: error instanceof Error ? error.message : undefined, variant: "destructive" }));
  }, [conversationId, open, toast]);

  const choose = (template: ChatTemplate) => {
    if (template.action) { setOpen(false); onAction(template.action); return; }
    setChosen(template); setText(template.text);
  };

  const send = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await apiRequest(`/api/crm/conversations/${conversationId}/templates/${chosen.id}/send`, { method: "POST", body: JSON.stringify({ text }) });
      toast({ title: `Отправлено: ${chosen.title}` }); setOpen(false); onSent();
    } catch (error) { toast({ title: "Шаблон не отправлен", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const closedWindow = state && !state.windowOpen && state.channel === "whatsapp";
  const leftover = /\{\{\s*[a-z_]+\s*\}\}/.test(text);

  return <>
    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" disabled={disabled} onClick={() => setOpen(true)}><FileText className="h-3.5 w-3.5" />Шаблоны</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{chosen ? chosen.title : "Шаблоны сообщений"}</DialogTitle>
          <DialogDescription>{chosen ? "Проверьте текст перед отправкой гостю." : "Те же тексты, что отправляет ИИ. Данные гостя и брони подставляются автоматически."}</DialogDescription></DialogHeader>
        {closedWindow && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Гость не писал больше 24 часов: WhatsApp пропустит только одобренный шаблон Meta.</p>}
        {!chosen ? <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {state?.templates.map((template) => {
            const blocked = !template.action && (template.missing.length > 0 || Boolean(closedWindow && !template.hasMetaTemplate));
            return <button key={template.id} type="button" onClick={() => choose(template)}
              className={cn("w-full rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-secondary/60", blocked && "opacity-70")}>
              <p className="flex items-center justify-between gap-2 text-sm font-medium">{template.title}
                {template.action ? <span className="text-[10px] font-normal text-muted-foreground">действие</span> : template.hasMetaTemplate ? <span className="text-[10px] font-normal text-emerald-700">шаблон Meta</span> : null}</p>
              {template.text && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{template.text}</p>}
              {template.missing.length > 0 && <p className="mt-1 text-[11px] text-amber-800">Нет данных: {template.missing.map((name) => VARIABLE_LABELS[name] ?? name).join(", ")} — допишите вручную</p>}
            </button>;
          })}
          {state && !state.templates.length && <p className="text-sm text-muted-foreground">Шаблонов нет.</p>}
        </div> : <div className="space-y-2">
          <Textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
          {leftover && <p className="text-xs text-amber-800">Замените поля в фигурных скобках перед отправкой.</p>}
        </div>}
        <DialogFooter>
          {chosen ? <><Button variant="outline" onClick={() => setChosen(null)}>Назад</Button><Button disabled={busy || !text.trim() || leftover} onClick={() => void send()}>Отправить</Button></>
            : <Button variant="outline" onClick={() => setOpen(false)}>Закрыть</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
};
