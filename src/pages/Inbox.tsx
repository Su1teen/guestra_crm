import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Inbox as InboxIcon, Paperclip, Send, StickyNote, UserPlus, Check } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { StatusPill } from "@/components/common/StatusPill";
import { Field, InitialsAvatar } from "@/components/common/Identity";
import { FilterSelect, SearchInput, SegmentedTabs } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { formatDateLong, formatRelative, formatStayRange, formatTenge, formatTime, occupancyLabel } from "@/lib/format";
import {
  channelLabels,
  conversationStatusLabels,
  offerStatusLabels,
  offerStatusTone,
  stageLabels,
  stageTone,
} from "@/lib/labels";
import type { Conversation } from "@/types/crm";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type InboxTab = "all" | "unread" | "mine" | "unassigned" | "pending" | "closed";

const channelOptions = [
  { value: "all", label: "Все каналы" },
  ...Object.entries(channelLabels).map(([value, label]) => ({ value, label })),
];

const Inbox = () => {
  const { status, reload, data, guestById, leadById, offerById, currentEmployee, employeeById, propertyById, sendMessage, markConversationRead, setConversationStatus, assignConversation } =
    useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<InboxTab>("all");
  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("conversation"));

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.conversations
      .filter((conversation) => {
        if (channel !== "all" && conversation.channel !== channel) return false;
        if (tab === "unread" && conversation.unreadCount === 0) return false;
        if (tab === "mine" && conversation.assigneeId !== currentEmployee.id) return false;
        if (tab === "unassigned" && conversation.assigneeId) return false;
        if (tab === "pending" && conversation.status !== "pending") return false;
        if (tab === "closed" && conversation.status !== "closed") return false;
        if (tab !== "closed" && tab !== "all" && conversation.status === "closed") return false;
        if (query) {
          const guest = guestById(conversation.guestId);
          const haystack = [guest?.fullName, guest?.phone, ...conversation.messages.map((message) => message.text)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [channel, currentEmployee.id, guestById, scoped.conversations, search, tab]);

  const selected: Conversation | undefined =
    filtered.find((conversation) => conversation.id === selectedId) ?? filtered[0];

  useEffect(() => {
    if (selected && selected.unreadCount > 0) {
      markConversationRead(selected.id);
    }
  }, [markConversationRead, selected]);

  useEffect(() => {
    if (selected && params.get("conversation") !== selected.id) {
      setParams({ conversation: selected.id }, { replace: true });
    }
  }, [params, selected, setParams]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const counts = {
    all: scoped.conversations.length,
    unread: scoped.conversations.filter((conversation) => conversation.unreadCount > 0).length,
    mine: scoped.conversations.filter((conversation) => conversation.assigneeId === currentEmployee.id).length,
    unassigned: scoped.conversations.filter((conversation) => !conversation.assigneeId).length,
    pending: scoped.conversations.filter((conversation) => conversation.status === "pending").length,
    closed: scoped.conversations.filter((conversation) => conversation.status === "closed").length,
  };

  const guest = selected ? guestById(selected.guestId) : undefined;
  const lead = selected?.leadId ? leadById(selected.leadId) : undefined;
  const offer = selected?.offerId ? offerById(selected.offerId) : undefined;

  const submit = () => {
    if (!selected || !draft.trim()) return;
    sendMessage(selected.id, draft.trim(), asNote);
    setDraft("");
    toast({ title: asNote ? "Внутренняя заметка добавлена" : "Сообщение отправлено" });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Входящие"
        description="Единый центр переписки с гостями по всем каналам"
        actions={
          <FilterSelect value={channel} onChange={setChannel} options={channelOptions} ariaLabel="Канал" />
        }
      />

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "Все", count: counts.all },
          { value: "unread", label: "Непрочитанные", count: counts.unread },
          { value: "mine", label: "Мои", count: counts.mine },
          { value: "unassigned", label: "Без ответственного", count: counts.unassigned },
          { value: "pending", label: "Ожидают ответа", count: counts.pending },
          { value: "closed", label: "Закрытые", count: counts.closed },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по диалогам" />
          <div className="max-h-[70vh] divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-card shadow-card">
            {filtered.map((conversation) => {
              const conversationGuest = guestById(conversation.guestId);
              const lastMessage = conversation.messages[conversation.messages.length - 1];
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                    selected?.id === conversation.id ? "bg-brand-50/70" : "hover:bg-secondary/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <InitialsAvatar name={conversationGuest?.fullName ?? "Гость"} size="sm" />
                      <span className="truncate text-sm font-medium text-foreground">
                        {conversationGuest?.fullName ?? "Гость"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelative(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{lastMessage?.text}</p>
                  <div className="flex items-center gap-1.5">
                    <StatusPill tone="neutral">{channelLabels[conversation.channel]}</StatusPill>
                    <StatusPill tone={conversation.status === "closed" ? "neutral" : conversation.status === "pending" ? "warning" : "info"}>
                      {conversationStatusLabels[conversation.status]}
                    </StatusPill>
                    {conversation.unreadCount > 0 && <StatusPill tone="brand">{conversation.unreadCount}</StatusPill>}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="p-4">
                <EmptyState compact title="Диалогов нет" description="Измените фильтр или поиск." icon={InboxIcon} />
              </div>
            )}
          </div>
        </div>

        {selected && guest ? (
          <div className="flex max-h-[70vh] flex-col rounded-2xl border border-border bg-card shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{guest.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {channelLabels[selected.channel]} · {propertyById(selected.propertyId)?.name ?? selected.propertyId} ·{" "}
                  {selected.assigneeId ? employeeById(selected.assigneeId)?.shortName ?? "без ответственного" : "без ответственного"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!selected.assigneeId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      assignConversation(selected.id, currentEmployee.id);
                      toast({ title: "Диалог назначен на вас" });
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Взять в работу
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setConversationStatus(selected.id, selected.status === "closed" ? "open" : "closed");
                    toast({ title: selected.status === "closed" ? "Диалог снова открыт" : "Диалог закрыт" });
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  {selected.status === "closed" ? "Открыть" : "Закрыть"}
                </Button>
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {selected.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm",
                    message.direction === "in"
                      ? "bg-secondary text-foreground"
                      : message.direction === "note"
                        ? "ml-auto border border-amber-200 bg-amber-50 text-amber-900"
                        : "ml-auto bg-brand-500 text-white",
                  )}
                >
                  {message.direction === "note" && (
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
                      <StickyNote className="h-3 w-3" />
                      Внутренняя заметка
                    </p>
                  )}
                  <p>{message.text}</p>
                  {message.attachmentName && (
                    <p
                      className={cn(
                        "mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs",
                        message.direction === "out" ? "bg-white/15" : "bg-card",
                      )}
                    >
                      <Paperclip className="h-3 w-3" />
                      {message.attachmentName}
                    </p>
                  )}
                  <p
                    className={cn(
                      "mt-1 text-[11px]",
                      message.direction === "out" ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {formatTime(message.at)}
                    {message.employeeId ? ` · ${employeeById(message.employeeId)?.shortName ?? "Сотрудник"}` : ""}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-border px-5 py-3">
              <Tabs value={asNote ? "note" : "reply"} onValueChange={(value) => setAsNote(value === "note")}>
                <TabsList>
                  <TabsTrigger value="reply">Ответ гостю</TabsTrigger>
                  <TabsTrigger value="note">Внутренняя заметка</TabsTrigger>
                </TabsList>
              </Tabs>
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                className="mt-3"
                placeholder={asNote ? "Заметка видна только команде" : "Напишите сообщение гостю"}
              />
              <div className="mt-2 flex items-center justify-between">
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled>
                  <Paperclip className="h-3.5 w-3.5" />
                  Вложение
                </Button>
                <Button size="sm" className="gap-1.5" onClick={submit} disabled={!draft.trim()}>
                  <Send className="h-3.5 w-3.5" />
                  {asNote ? "Сохранить заметку" : "Отправить"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Диалог не выбран" description="Выберите переписку из списка." icon={InboxIcon} />
        )}

        {selected && guest && (
          <aside className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card">
            <div>
              <p className="text-sm font-semibold text-foreground">Контекст гостя</p>
              <Link to={`/guests/${guest.id}`} className="text-xs text-brand-600 hover:underline">
                Открыть профиль 360
              </Link>
            </div>
            <div className="space-y-3">
              <Field label="Телефон">{guest.phone}</Field>
              <Field label="Email">{guest.email}</Field>
              <Field label="Проживаний">{guest.staysCount}</Field>
              <Field label="LTV">{formatTenge(guest.lifetimeValue)}</Field>
              <Field label="Последний визит">
                {guest.lastStayDate ? formatDateLong(guest.lastStayDate) : "Ещё не проживал"}
              </Field>
              <Field label="Предпочтения">{guest.preferences.roomPreference}</Field>
            </div>

            {lead && (
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/leads/${lead.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                    {lead.code}
                  </Link>
                  <StatusPill tone={stageTone[lead.stage]}>{stageLabels[lead.stage]}</StatusPill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {propertyById(lead.propertyId)?.name ?? lead.propertyId} · {formatStayRange(lead.checkIn, lead.checkOut)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lead.roomType} · {occupancyLabel(lead.adults, lead.children)}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatTenge(lead.totalAmount)}</p>
              </div>
            )}

            {offer && (
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/offers/${offer.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                    {offer.code}
                  </Link>
                  <StatusPill tone={offerStatusTone[offer.status]}>{offerStatusLabels[offer.status]}</StatusPill>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatTenge(offer.total)}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Назначить</p>
              <FilterSelect
                value={selected.assigneeId ?? "none"}
                onChange={(value) => {
                  if (value === "none") return;
                  assignConversation(selected.id, value);
                  toast({ title: "Ответственный обновлён" });
                }}
                options={[
                  { value: "none", label: "Без ответственного" },
                  ...data.employees.map((employee) => ({ value: employee.id, label: employee.name })),
                ]}
                className="w-full"
              />
            </div>

            {lead && (
              <Button variant="outline" className="w-full" onClick={() => navigate(`/leads/${lead.id}`)}>
                Открыть сделку
              </Button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

export default Inbox;
