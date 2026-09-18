import type { Guest, PropertyId } from '@/types/crm';

export type ReviewChannel = '2gis' | 'google' | 'yandex' | 'booking' | 'tripadvisor' | 'direct';
export type ReputationReview = { id: string; guestId: string; guestName: string; propertyId: PropertyId; channel: ReviewChannel; rating: number; maxRating: number; date: string; text: string; topic: string };

export const CHANNELS: { id: ReviewChannel; name: string; scale: string; networkRating: number; count: number; note: string }[] = [
  { id: '2gis', name: '2ГИС', scale: '/ 5', networkRating: 4.7, count: 342, note: 'Карточки объектов в Казахстане' },
  { id: 'google', name: 'Google Maps', scale: '/ 5', networkRating: 4.6, count: 286, note: 'Поиск и карты' },
  { id: 'yandex', name: 'Яндекс Карты', scale: '/ 5', networkRating: 4.5, count: 184, note: 'Карты и навигация' },
  { id: 'booking', name: 'Booking.com', scale: '/ 10', networkRating: 8.9, count: 215, note: 'Оценка подтверждённых гостей' },
  { id: 'tripadvisor', name: 'Tripadvisor', scale: '/ 5', networkRating: 4.4, count: 94, note: 'Путешествия' },
  { id: 'direct', name: 'Опрос после выезда', scale: '/ 5', networkRating: 4.8, count: 127, note: 'Прямая обратная связь' },
];

const samples = [
  { channel: '2gis', rating: 5, text: 'Очень понравился сервис и территория. Обязательно приедем снова.', topic: 'Сервис' },
  { channel: 'booking', rating: 9, text: 'Хороший завтрак, внимательный персонал и удобный номер.', topic: 'Питание' },
  { channel: 'google', rating: 3, text: 'Вечером долго ждали заселения. Остальное понравилось.', topic: 'Заселение' },
  { channel: 'yandex', rating: 5, text: 'Чисто и спокойно. Отличный вариант для семейной поездки.', topic: 'Чистота' },
  { channel: '2gis', rating: 2, text: 'В ресторане долго несли заказ, хотелось бы быстрее.', topic: 'Ресторан' },
  { channel: 'tripadvisor', rating: 5, text: 'Прекрасная баня и уютные домики. Хороший отдых.', topic: 'SPA и баня' },
  { channel: 'direct', rating: 4, text: 'Персонал помог организовать трансфер. Спасибо за заботу.', topic: 'Трансфер' },
  { channel: 'booking', rating: 7, text: 'Номер удобный, но ночью было слышно соседей.', topic: 'Номер' },
  { channel: 'google', rating: 5, text: 'Красивое место, внимательная команда и вкусный ужин.', topic: 'Общее впечатление' },
  { channel: 'yandex', rating: 3, text: 'Удобное расположение. В ванной не хватало принадлежностей.', topic: 'Оснащение' },
  { channel: '2gis', rating: 4, text: 'Приезжаем всей семьёй второй раз. Дети в восторге.', topic: 'Семья' },
  { channel: 'direct', rating: 5, text: 'Очень понравилась процедура в SPA, спасибо мастеру.', topic: 'SPA' },
] as const;

export function buildReputationReviews(guests: Guest[]): ReputationReview[] {
  const eligible = guests.filter((guest) => guest.staysCount > 0);
  return samples.slice(0, eligible.length).map((sample, index) => {
    const guest = eligible[index];
    const channel = sample.channel as ReviewChannel;
    return {
      id: `demo-review-${index + 1}`,
      guestId: guest.id,
      guestName: guest.fullName,
      propertyId: guest.preferredPropertyId,
      channel,
      rating: sample.rating,
      maxRating: channel === 'booking' ? 10 : 5,
      date: new Date(2026, 8, 16 - index * 3).toISOString(),
      text: sample.text,
      topic: sample.topic,
    };
  });
}

export function isNegative(review: ReputationReview) { return review.rating / review.maxRating < 0.7; }
