import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, ShieldAlert, Star, TrendingUp } from 'lucide-react';
import { useCrm } from '@/store/crm-store';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingScreen } from '@/components/common/States';
import { propertyById } from '@/data/reference';
import { buildReputationReviews, CHANNELS, isNegative, type ReviewChannel } from '@/lib/reputation-demo';
import './reputation.css';

const STORAGE_KEY = 'guestra.crm.reputation-demo.v1';
type StatusMap = Record<string, { status: 'draft' | 'answered'; reply: string }>;
function readStatuses(): StatusMap {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as StatusMap; } catch { return {}; }
}
const pct = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;

export default function Reputation() {
  const { data, property, status, reload } = useCrm();
  const [channel, setChannel] = useState<ReviewChannel | 'all'>('all');
  const [filter, setFilter] = useState<'all' | 'negative' | 'unanswered'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [statuses, setStatuses] = useState<StatusMap>(readStatuses);
  const reviews = useMemo(() => buildReputationReviews(data.guests).filter((review) => property === 'all' || review.propertyId === property), [data.guests, property]);
  const visible = reviews.filter((review) => (channel === 'all' || review.channel === channel) && (filter === 'all' || (filter === 'negative' ? isNegative(review) : statuses[review.id]?.status !== 'answered')));
  const answered = reviews.filter((review) => statuses[review.id]?.status === 'answered').length;
  const negatives = reviews.filter((review) => isNegative(review) && statuses[review.id]?.status !== 'answered').length;
  const mean = reviews.length ? (reviews.reduce((sum, review) => sum + review.rating / review.maxRating * 5, 0) / reviews.length).toFixed(1) : '—';
  const updateStatus = (id: string, next: StatusMap[string]) => {
    const updated = { ...statuses, [id]: next };
    setStatuses(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* demo state remains visible until reload */ }
  };

  if (status === 'error') return <ErrorState onRetry={reload} />;
  if (status === 'loading') return <LoadingScreen />;

  return <div className="rep">
    <PageHeader title="Репутация и отзывы" description="Рейтинги по каналам, отзывы гостей и контроль ответов по сети ЛЕС" meta={<span className="rep-demo">Демо-данные · без интеграций</span>} />
    <div className="rep-summary">
      <div><span className="rep-icon"><Star size={19} /></span><small>Средний балл в демо-отзывах</small><strong>{mean} <em>/ 5</em></strong><p>Booking.com приведён к шкале 5 только для внутреннего сравнения</p></div>
      <div><span className="rep-icon"><MessageSquareText size={19} /></span><small>Ответы в журнале</small><strong>{pct(answered, reviews.length)}%</strong><p>{answered} из {reviews.length} отзывов отмечены отвеченными</p></div>
      <div><span className="rep-icon alert"><ShieldAlert size={19} /></span><small>Негатив требует внимания</small><strong>{negatives}</strong><p>Оценка ниже 70% шкалы без ответа</p></div>
    </div>
    <section className="rep-panel"><div className="rep-panel-head"><div><h2>Каналы присутствия</h2><p>Рейтинги и количество отзывов ниже — реалистичные mock-показатели карточек, без синхронизации.</p></div><TrendingUp size={20} /></div><div className="rep-channels">{CHANNELS.map((item) => <button type="button" key={item.id} className={channel === item.id ? 'active' : ''} onClick={() => setChannel(channel === item.id ? 'all' : item.id)}><span>{item.name}</span><strong><Star size={15} />{item.networkRating} <small>{item.scale}</small></strong><p>{item.count} оценок · {item.note}</p></button>)}</div></section>
    <section className="rep-panel"><div className="rep-panel-head"><div><h2>Лента отзывов</h2><p>Сохранённые ответы в этой версии — внутренние отметки, публикации на площадках нет.</p></div><div className="rep-filters"><select aria-label="Канал" value={channel} onChange={(event) => setChannel(event.target.value as ReviewChannel | 'all')}><option value="all">Все каналы</option>{CHANNELS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Статус" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Все отзывы</option><option value="negative">Негатив</option><option value="unanswered">Без ответа</option></select></div></div><div className="rep-list">{visible.map((review) => {
      const source = CHANNELS.find((item) => item.id === review.channel)!;
      const item = statuses[review.id];
      const open = selected === review.id;
      return <article key={review.id} className="rep-review"><div className="rep-review-main"><div className="rep-review-head"><span className="rep-channel-tag">{source.name}</span><span className={`rep-score ${isNegative(review) ? 'negative' : ''}`}><Star size={13} /> {review.rating} / {review.maxRating}</span><span className="rep-topic">{review.topic}</span><span className="rep-date">{new Date(review.date).toLocaleDateString('ru-RU')}</span></div><p className="rep-quote">«{review.text}»</p><div className="rep-review-foot"><Link to={`/guests/${review.guestId}`}>{review.guestName}</Link><span>· {propertyById(review.propertyId).name}</span><span className={`rep-state ${item?.status === 'answered' ? 'answered' : ''}`}>{item?.status === 'answered' ? 'Ответ отмечен' : item?.status === 'draft' ? 'Черновик' : 'Нужен ответ'}</span><button type="button" onClick={() => { setSelected(open ? null : review.id); setDraft(item?.reply ?? ''); }}>{open ? 'Скрыть' : 'Работа с отзывом'}</button></div></div>{open && <div className="rep-reply"><label htmlFor={`reply-${review.id}`}>Внутренний черновик ответа</label><textarea id={`reply-${review.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Поблагодарите гостя и ответьте по существу. Отправка на площадку выполняется отдельно." /><div><button type="button" onClick={() => updateStatus(review.id, { status: 'draft', reply: draft })} disabled={!draft.trim()}>Сохранить черновик</button><button type="button" className="primary" onClick={() => { updateStatus(review.id, { status: 'answered', reply: draft }); setSelected(null); }} disabled={!draft.trim()}>Отметить как отвеченный</button></div></div>}</article>;
    })}{visible.length === 0 && <EmptyState compact title="По этим фильтрам отзывов нет" />}</div></section>
    <p className="rep-note">2ГИС рассчитывает публичный рейтинг по собственной формуле; число на карточке нельзя пересчитать простым средним оценок. Для реальной интеграции понадобятся идентификатор площадки, URL отзыва, связь с гостем и статус публикации ответа.</p>
  </div>;
}
