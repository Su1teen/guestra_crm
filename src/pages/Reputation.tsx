import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquareText, ShieldAlert, Star } from "lucide-react";
import { useCrm } from "@/store/crm-store";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildReputationReviews, CHANNELS, type ReviewChannel } from "@/lib/reputation-demo";
import type { GuestReview } from "@/types/crm";
import "./reputation.css";

const STORAGE_KEY = "guestra.crm.reputation-demo.v1";
type DemoStatus = Record<string, { status: "draft" | "answered"; reply: string }>;
const readDemoStatus = (): DemoStatus => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as DemoStatus; } catch { return {}; }
};
const pct = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;
type ReviewRow = GuestReview;

export default function Reputation() {
  const { data, dataMode, property, status, reload, propertyById, createReview, updateReview } = useCrm();
  const { toast } = useToast();
  const [channel, setChannel] = useState<ReviewChannel | "all">("all");
  const [filter, setFilter] = useState<"all" | "negative" | "unanswered">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [demoStatuses, setDemoStatuses] = useState<DemoStatus>(readDemoStatus);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ propertyId: "", guestId: "", guestName: "", stayId: "",
    channel: "direct" as ReviewChannel, rating: 5, topic: "Общее впечатление", text: "", externalUrl: "" });

  const reviews = useMemo<ReviewRow[]>(() => {
    const actual = dataMode === "database" ? data.reviews : [
      ...data.reviews,
      ...buildReputationReviews(data.guests).map((item) => ({ id: item.id, propertyId: item.propertyId,
        guestId: item.guestId, guestName: item.guestName, channel: item.channel, rating: item.rating,
        maxRating: item.maxRating, reviewAt: item.date, text: item.text, topic: item.topic,
        status: demoStatuses[item.id]?.status ?? "new", reply: demoStatuses[item.id]?.reply } as ReviewRow)),
    ];
    return actual.filter((review) => property === "all" || review.propertyId === property)
      .sort((a, b) => b.reviewAt.localeCompare(a.reviewAt));
  }, [data.guests, data.reviews, dataMode, demoStatuses, property]);
  const negative = (review: ReviewRow) => review.rating / review.maxRating < 0.7;
  const visible = reviews.filter((review) => (channel === "all" || review.channel === channel) &&
    (filter === "all" || filter === "negative" && negative(review) || filter === "unanswered" && review.status !== "answered"));
  const answered = reviews.filter((review) => review.status === "answered").length;
  const negatives = reviews.filter((review) => negative(review) && review.status !== "answered").length;
  const mean = reviews.length ? (reviews.reduce((sum, review) => sum + review.rating / review.maxRating * 5, 0) / reviews.length).toFixed(1) : "—";
  const maxRating = form.channel === "booking" ? 10 : 5;
  const completedStays = data.stays.filter((stay) => stay.guestId === form.guestId && (stay.operationalStatus === "checked_out" || stay.status === "completed"));

  const saveReply = async (review: ReviewRow, nextStatus: "draft" | "answered") => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      if (dataMode === "database" || data.reviews.some((item) => item.id === review.id)) await updateReview(review.id, { status: nextStatus, reply: draft.trim() });
      else {
        const next = { ...demoStatuses, [review.id]: { status: nextStatus, reply: draft.trim() } };
        setDemoStatuses(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      toast({ title: nextStatus === "answered" ? "Ответ отмечен в журнале" : "Черновик сохранён" });
      if (nextStatus === "answered") setSelected(null);
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const addReview = async () => {
    const guest = data.guests.find((item) => item.id === form.guestId);
    setSaving(true);
    try {
      await createReview({ propertyId: form.propertyId || (property === "all" ? data.properties[0]?.id : property),
        guestId: guest?.id, stayId: form.stayId || undefined, guestName: guest?.fullName ?? form.guestName.trim(),
        channel: form.channel, rating: form.rating, maxRating, reviewAt: new Date().toISOString(),
        text: form.text.trim(), topic: form.topic.trim() || "Общее впечатление",
        externalUrl: form.externalUrl.trim() || undefined });
      setCreating(false);
      setForm((current) => ({ ...current, guestId: "", guestName: "", stayId: "", text: "", externalUrl: "" }));
      toast({ title: "Отзыв добавлен в журнал" });
    } catch (error) {
      toast({ title: "Не удалось добавить отзыв", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  return <div className="rep">
    <PageHeader title="Репутация и отзывы" description="Журнал обратной связи после проживания и ответов команды"
      meta={dataMode === "mock" ? <span className="rep-demo">Демо-данные</span> : undefined}
      actions={<Button onClick={() => { setForm((current) => ({ ...current, propertyId: property === "all" ? data.properties[0]?.id ?? "" : property })); setCreating(true); }}>Добавить отзыв</Button>} />
    <div className="rep-summary">
      <div><span className="rep-icon"><Star size={19} /></span><small>Средний балл записанных отзывов</small><strong>{mean} <em>/ 5</em></strong><p>Оценки разных площадок приведены к шкале 5 только для внутреннего сравнения</p></div>
      <div><span className="rep-icon"><MessageSquareText size={19} /></span><small>Ответы в журнале</small><strong>{pct(answered, reviews.length)}%</strong><p>{answered} из {reviews.length} отзывов отмечены отвеченными</p></div>
      <div><span className="rep-icon alert"><ShieldAlert size={19} /></span><small>Негатив требует внимания</small><strong>{negatives}</strong><p>Оценка ниже 70% шкалы без ответа</p></div>
    </div>
    <section className="rep-panel"><div className="rep-panel-head"><div><h2>Каналы</h2><p>{dataMode === "database" ? "Показаны только записанные отзывы. Синхронизация с площадками пока не подключена." : "Показатели в демо-режиме учебные."}</p></div></div>
      <div className="rep-channels">{CHANNELS.map((item) => { const channelReviews = reviews.filter((review) => review.channel === item.id); const channelMean = channelReviews.length ? (channelReviews.reduce((sum, review) => sum + review.rating / review.maxRating * 5, 0) / channelReviews.length).toFixed(1) : "—"; return <button type="button" key={item.id} className={channel === item.id ? "active" : ""} onClick={() => setChannel(channel === item.id ? "all" : item.id)}><span>{item.name}</span><strong><Star size={15} />{channelMean} <small>/ 5</small></strong><p>{channelReviews.length} отзывов в журнале</p></button>; })}</div>
    </section>
    <section className="rep-panel"><div className="rep-panel-head"><div><h2>Лента отзывов</h2><p>Ответы здесь — внутренний журнал. Публикация на площадке выполняется отдельно.</p></div><div className="rep-filters"><select aria-label="Канал" value={channel} onChange={(event) => setChannel(event.target.value as ReviewChannel | "all")}><option value="all">Все каналы</option>{CHANNELS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Статус" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Все отзывы</option><option value="negative">Негатив</option><option value="unanswered">Без ответа</option></select></div></div>
      <div className="rep-list">{visible.map((review) => { const source = CHANNELS.find((item) => item.id === review.channel); const open = selected === review.id; return <article key={review.id} className="rep-review"><div className="rep-review-main"><div className="rep-review-head"><span className="rep-channel-tag">{source?.name ?? review.channel}</span><span className={`rep-score ${negative(review) ? "negative" : ""}`}><Star size={13} /> {review.rating} / {review.maxRating}</span><span className="rep-topic">{review.topic}</span><span className="rep-date">{new Date(review.reviewAt).toLocaleDateString("ru-RU")}</span></div><p className="rep-quote">«{review.text}»</p><div className="rep-review-foot">{review.guestId ? <Link to={`/guests/${review.guestId}`}>{review.guestName}</Link> : <span>{review.guestName}</span>}<span>· {propertyById(review.propertyId)?.name ?? review.propertyId}</span><span className={`rep-state ${review.status === "answered" ? "answered" : ""}`}>{review.status === "answered" ? "Ответ отмечен" : review.status === "draft" ? "Черновик" : "Нужен ответ"}</span><button type="button" onClick={() => { setSelected(open ? null : review.id); setDraft(review.reply ?? ""); }}>{open ? "Скрыть" : "Работа с отзывом"}</button></div></div>{open && <div className="rep-reply"><label htmlFor={`reply-${review.id}`}>Внутренний черновик ответа</label><textarea id={`reply-${review.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ответ на площадке публикуется отдельно" /><div><button type="button" onClick={() => void saveReply(review, "draft")} disabled={saving || !draft.trim()}>Сохранить черновик</button><button type="button" className="primary" onClick={() => void saveReply(review, "answered")} disabled={saving || !draft.trim()}>Отметить как отвеченный</button></div></div>}</article>; })}{visible.length === 0 && <EmptyState compact title="По этим фильтрам отзывов нет" />}</div>
    </section>
    <Dialog open={creating} onOpenChange={setCreating}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Добавить отзыв</DialogTitle><DialogDescription>Запишите полученную обратную связь. Ответ на внешней площадке отмечается отдельно.</DialogDescription></DialogHeader>
      <div className="grid gap-3"><div className="space-y-1"><Label htmlFor="review-property">Объект</Label><select id="review-property" className="w-full rounded-md border bg-background p-2 text-sm" value={form.propertyId} onChange={(event) => setForm({ ...form, propertyId: event.target.value })}>{data.properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="review-guest">Гость / контакт</Label><select id="review-guest" className="w-full rounded-md border bg-background p-2 text-sm" value={form.guestId} onChange={(event) => { const guest = data.guests.find((item) => item.id === event.target.value); setForm({ ...form, guestId: event.target.value, guestName: guest?.fullName ?? form.guestName, stayId: "" }); }}><option value="">Автор не найден</option>{data.guests.filter((item) => item.propertyIds.includes(form.propertyId)).map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></div>
        {!form.guestId && <div className="space-y-1"><Label htmlFor="review-name">Имя автора</Label><Input id="review-name" value={form.guestName} onChange={(event) => setForm({ ...form, guestName: event.target.value })} /></div>}
        {completedStays.length > 0 && <div className="space-y-1"><Label htmlFor="review-stay">Проживание</Label><select id="review-stay" className="w-full rounded-md border bg-background p-2 text-sm" value={form.stayId} onChange={(event) => setForm({ ...form, stayId: event.target.value })}><option value="">Без связи с проживанием</option>{completedStays.map((item) => <option key={item.id} value={item.id}>{item.bookingReference}</option>)}</select></div>}
        <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor="review-channel">Канал</Label><select id="review-channel" className="w-full rounded-md border bg-background p-2 text-sm" value={form.channel} onChange={(event) => { const next = event.target.value as ReviewChannel; setForm({ ...form, channel: next, rating: Math.min(form.rating, next === "booking" ? 10 : 5) }); }}>{CHANNELS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="space-y-1"><Label htmlFor="review-rating">Оценка из {maxRating}</Label><Input id="review-rating" type="number" min={0} max={maxRating} value={form.rating} onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })} /></div></div>
        <div className="space-y-1"><Label htmlFor="review-topic">Тема</Label><Input id="review-topic" value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="review-text">Текст отзыва</Label><Textarea id="review-text" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="review-url">Ссылка на отзыв, если есть</Label><Input id="review-url" value={form.externalUrl} onChange={(event) => setForm({ ...form, externalUrl: event.target.value })} /></div></div>
      <DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button><Button disabled={saving || !form.propertyId || !form.guestName.trim() || form.text.trim().length < 2 || form.rating < 0 || form.rating > maxRating} onClick={() => void addReview()}>Сохранить отзыв</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
