import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatDateNumeric } from "@/lib/format";
import { useCrm } from "@/store/crm-store";

type Job = { id: string; triggerType: string; scheduledAt: string; status: string };
export const ReservationReminders = ({ reservationId, status }: { reservationId: string; status: string }) => {
  const { dataMode, data } = useCrm();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>(() => dataMode === "mock" ? (data.scheduledOutboundMessages ?? []).filter((job) => job.reservationId === reservationId) : []);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (dataMode !== "database") return;
    let active = true;
    void apiRequest<Job[]>(`/api/crm/reservations/${reservationId}/scheduled-messages`)
      .then((items) => { if (active) setJobs(items); })
      .catch(() => { if (active) setJobs([]); });
    return () => { active = false; };
  }, [dataMode, reservationId]);
  const sendNow = async () => {
    setSending(true);
    try {
      await apiRequest(`/api/crm/reservations/${reservationId}/remind-now`, { method: "POST",
        body: JSON.stringify({ idempotencyKey: `manual:${reservationId}:${crypto.randomUUID()}` }) });
      setJobs(await apiRequest<Job[]>(`/api/crm/reservations/${reservationId}/scheduled-messages`));
      toast({ title: "Напоминание отправлено" });
    } catch (error) { toast({ title: "Не удалось отправить напоминание", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setSending(false); }
  };
  if (status !== "confirmed") return null;
  return <section className="rounded-xl border p-3 text-sm"><p className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4" />Напоминания до заезда</p>
    <div className="mt-2 space-y-1">{jobs.filter((job) => job.status === "pending").map((job) =>
      <p key={job.id} className="text-xs text-muted-foreground">{job.triggerType === "pre_arrival_3d" ? "За 3 дня" : job.triggerType === "pre_arrival_1d" ? "За 1 день" : "Вручную"} · {formatDateNumeric(job.scheduledAt)}</p>)}
      {!jobs.some((job) => job.status === "pending") && <p className="text-xs text-muted-foreground">Запланированных сообщений нет</p>}</div>
    <Button size="sm" variant="outline" className="mt-3" disabled={sending || dataMode !== "database"} onClick={() => void sendNow()}>Отправить напоминание сейчас</Button>
  </section>;
};
