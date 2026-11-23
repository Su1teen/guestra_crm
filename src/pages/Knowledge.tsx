import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";

interface KnowledgeItem { id: string; topic: string; title: string; content: string; tags: string[]; language: string; active: boolean; updatedAt: string }
interface KnowledgeResponse { topics: { topic: string; title: string }[]; items: KnowledgeItem[]; canEdit: boolean }

/** AI Studio, where the answer of the agent to a test message can be checked after a text changes. */
const STUDIO_URL = "https://guestrastudio.up.railway.app";

/**
 * AI knowledge base of a property: one text per topic and language. Prices, free rooms and promo prices are not
 * written here — the agent reads them from PMS.
 */
const Knowledge = () => {
  const { toast } = useToast();
  const { data, property } = useCrm();
  const properties = data.properties;
  const [propertyId, setPropertyId] = useState<string>(property !== "all" ? property : properties[0]?.id ?? "");
  const [state, setState] = useState<KnowledgeResponse | null>(null);
  const [draft, setDraft] = useState<{ topic: string; title: string; content: string; tags: string; language: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!propertyId && properties[0]) setPropertyId(properties[0].id); }, [properties, propertyId]);
  const load = useCallback(() => {
    if (!propertyId) return;
    apiRequest<KnowledgeResponse>(`/api/crm/knowledge?propertyId=${encodeURIComponent(propertyId)}`).then(setState).catch(() => setState(null));
  }, [propertyId]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const items = state?.items ?? [];
    const suggested = (state?.topics ?? []).filter((topic) => !items.some((item) => item.topic === topic.topic))
      .map((topic) => ({ id: "", topic: topic.topic, title: topic.title, content: "", tags: [], language: "ru", active: false, updatedAt: "" }));
    return [...items, ...suggested];
  }, [state]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await apiRequest("/api/crm/knowledge", { method: "PUT", body: JSON.stringify({ propertyId, topic: draft.topic, title: draft.title, content: draft.content,
        language: draft.language, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }) });
      setDraft(null); load(); toast({ title: "Сохранено", description: "Проверьте ответ ИИ в Studio на тестовом сообщении." });
    } catch (error) { toast({ title: "Не сохранено", description: error instanceof Error ? error.message : String(error), variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const toggle = async (item: KnowledgeItem) => {
    await apiRequest(`/api/crm/knowledge/${item.id}`, { method: "PATCH", body: JSON.stringify({ propertyId, active: !item.active }) }).catch(() => undefined);
    load();
  };

  return <div className="space-y-5">
    <PageHeader title="База знаний ИИ" description="Тексты, по которым ИИ отвечает гостям. Цены, свободные номера и цены акций ИИ берёт из PMS, а не отсюда."
      actions={<div className="flex gap-2">
        <select aria-label="Объект" className="rounded-md border px-2 py-1 text-sm" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
          {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <Button asChild variant="outline" size="sm"><a href={STUDIO_URL} target="_blank" rel="noreferrer">Проверить ответ ИИ в Studio<ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
      </div>} />
    <SectionCard title="Темы" description="Если в теме нет ответа или данные противоречат, ИИ уточняет у гостя или передаёт сотруднику («ИИ не уверен в ответе»).">
      <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Тема</th><th className="pr-3">Текст</th><th className="pr-3">Статус</th><th /></tr></thead>
        <tbody>{rows.map((item) => <tr key={`${item.topic}-${item.language}`} className="border-b align-top">
          <td className="py-2 pr-3"><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.topic} · {item.language}</p></td>
          <td className="py-2 pr-3 text-muted-foreground">{item.content ? `${item.content.slice(0, 160)}${item.content.length > 160 ? "…" : ""}` : "не заполнено"}</td>
          <td className="py-2 pr-3">{item.id ? (item.active ? "Используется" : "Выключена") : "—"}</td>
          <td className="py-2 text-right">{state?.canEdit && <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setDraft({ topic: item.topic, title: item.title, content: item.content, tags: item.tags.join(", "), language: item.language })}>{item.id ? "Изменить" : "Заполнить"}</Button>
            {item.id && <Button size="sm" variant="ghost" onClick={() => void toggle(item as KnowledgeItem)}>{item.active ? "Выключить" : "Включить"}</Button>}
          </div>}</td>
        </tr>)}</tbody></table>
      {state?.canEdit && !draft && <Button className="mt-3" size="sm" variant="outline" onClick={() => setDraft({ topic: "", title: "", content: "", tags: "", language: "ru" })}>+ Своя тема</Button>}
    </SectionCard>
    {draft && <SectionCard title={draft.title || "Новая тема"}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Код темы<Input aria-label="Код темы" value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} /></label>
        <label className="text-sm">Название<Input aria-label="Название" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="text-sm">Язык<Input aria-label="Язык" value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })} /></label>
      </div>
      <label className="mt-3 block text-sm">Текст<Textarea aria-label="Текст" rows={8} maxLength={6000} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>
      <label className="mt-3 block text-sm">Теги через запятую<Input aria-label="Теги" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
      <div className="mt-3 flex gap-2"><Button size="sm" disabled={saving || draft.topic.trim().length < 2 || draft.title.trim().length < 2 || !draft.content.trim()} onClick={() => void save()}>Сохранить</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Отмена</Button></div>
    </SectionCard>}
  </div>;
};

export default Knowledge;
