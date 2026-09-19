import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import {
  evaluateJourney,
  journeyStageLabels,
  type JourneyEvaluation,
  type JourneyInput,
  type JourneyStage,
} from "../../shared/journey.js";
import type { InterestDetails } from "../../shared/service-groups.js";
import {
  createOfferFromFolio,
  ensureFolio,
  recalcFolio,
  setFolioStatus,
  type FolioRow,
} from "./folio.js";

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;

type DbLike = Pick<Database, "select" | "insert" | "update" | "delete">;

export interface JourneyContext {
  lead: typeof s.leads.$inferSelect;
  folio: FolioRow;
  input: JourneyInput;
  evaluation: JourneyEvaluation;
}

/** Собирает нормализованный вход для evaluateJourney из БД. */
export const loadJourneyContext = async (db: DbLike, leadId: string): Promise<JourneyContext | null> => {
  const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
  if (!lead) return null;
  const [interests, items, offers, classification, folio] = await Promise.all([
    db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, leadId)),
    db.select().from(s.leadItems).where(eq(s.leadItems.leadId, leadId)),
    db.select().from(s.offers).where(eq(s.offers.leadId, leadId)),
    db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, leadId)).limit(1),
    ensureFolio(db, lead),
  ]);
  const input: JourneyInput = {
    stage: lead.stage as JourneyStage,
    hasGuest: Boolean(lead.guestId),
    propertyId: lead.propertyId,
    source: lead.source,
    ownerId: lead.ownerId,
    quality: classification[0]?.manualPreviousQuality ?? classification[0]?.quality ?? null,
    interests: interests.map((interest) => ({
      direction: interest.direction,
      details: (interest.details ?? null) as InterestDetails | null,
    })),
    items: items.map((item) => ({
      type: item.type,
      name: item.name,
      status: item.status,
      quantity: item.quantity,
      startAt: item.startAt,
      endAt: item.endAt,
      participants: item.participants,
      adults: item.adults,
      nights: item.nights,
      unitAmount: item.unitAmount,
      totalAmount: item.totalAmount,
      pricingMode: item.pricingModeSnapshot,
      metadata: item.metadata,
    })),
    offers: offers.map((offer) => ({ status: offer.status })),
    folio: {
      totalAmount: folio.totalAmount,
      depositRequired: folio.depositRequired,
      paidAmount: folio.paidAmount,
      status: folio.status,
    },
  };
  return { lead, folio, input, evaluation: evaluateJourney(input) };
};

const probabilityFor = (stage: JourneyStage) =>
  stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "planning" ? 45
    : stage === "offer" ? 60 : stage === "payment_pending" ? 80
    : stage === "confirmed" ? 100 : stage === "completed" ? 100 : 0;

const OPEN_ITEM_STATUSES = ["interest", "selected", "quoted"] as const;

/**
 * Применяет переход этапа со всеми side-эффектами. Должна вызываться после
 * evaluateJourney (валидность уже проверена вызывающим кодом).
 */
export const applyStageTransition = async (
  db: DbLike,
  ctx: JourneyContext,
  target: JourneyStage,
  employeeId: string | null | undefined,
  opts: { lostReason?: string; comment?: string } = {},
) => {
  const timestamp = now();
  const { lead, folio } = ctx;
  const patch: Record<string, unknown> = {
    stage: target,
    probability: probabilityFor(target),
    lastActivityAt: timestamp,
    updatedAt: timestamp,
  };
  if (target === "payment_pending") patch.paymentStatus = "awaiting";
  if (target === "lost") patch.lostReason = opts.lostReason;
  if (target === "confirmed" && !lead.bookingReference) patch.bookingReference = `LES-${lead.code}`;

  await db.update(s.leads).set(patch).where(eq(s.leads.id, lead.id));
  await db.insert(s.leadStageHistory).values({
    id: newId("stage"), leadId: lead.id, stage: target, employeeId, changedAt: timestamp,
  });
  const titles: Partial<Record<JourneyStage, string>> = {
    lost: "Сделка потеряна",
    cancelled: "Подтверждённый заказ отменён",
    completed: "Услуги оказаны — заказ завершён",
  };
  await db.insert(s.leadActivities).values({
    id: newId("activity"), leadId: lead.id, employeeId, type: "stage_change",
    title: titles[target] ?? `Этап: ${journeyStageLabels[target]}`,
    description: opts.comment ?? opts.lostReason ?? undefined,
    occurredAt: timestamp,
  });

  switch (target) {
    case "offer": {
      // Формируем предложение из фолио, если ещё нет активного.
      const hasActiveOffer = ctx.input.offers.some((offer) => ["draft", "sent", "viewed"].includes(offer.status));
      if (!hasActiveOffer) await createOfferFromFolio(db, lead, folio, employeeId);
      await db.update(s.leadItems).set({ status: "quoted", updatedAt: timestamp })
        .where(and(eq(s.leadItems.leadId, lead.id), inArray(s.leadItems.status, ["interest", "selected"])));
      await setFolioStatus(db, folio.id, "quoted");
      break;
    }
    case "payment_pending":
      await setFolioStatus(db, folio.id, "payment_pending");
      break;
    case "confirmed": {
      await db.update(s.leadItems).set({ status: "confirmed", updatedAt: timestamp })
        .where(and(eq(s.leadItems.leadId, lead.id), inArray(s.leadItems.status, [...OPEN_ITEM_STATUSES])));
      await setFolioStatus(
        db, folio.id,
        folio.balance <= 0 && folio.totalAmount > 0 ? "settled" : folio.totalAmount > 0 ? "payment_pending" : "open",
      );
      break;
    }
    case "completed": {
      await db.update(s.leadItems).set({ status: "completed", updatedAt: timestamp })
        .where(and(eq(s.leadItems.leadId, lead.id), ne(s.leadItems.status, "cancelled")));
      await setFolioStatus(db, folio.id, "closed");
      // Standalone-услуги (не проживание) попадают в историю гостя.
      const items = await db.select().from(s.leadItems)
        .where(and(eq(s.leadItems.leadId, lead.id), ne(s.leadItems.type, "accommodation"), ne(s.leadItems.status, "cancelled")));
      if (items.length) {
        await db.insert(s.guestServices).values(items.map((item) => ({
          id: newId("service"), guestId: lead.guestId, leadId: lead.id, propertyId: lead.propertyId,
          name: item.name, serviceType: item.type, date: item.startAt ?? timestamp,
          amount: item.totalAmount ?? 0, quantity: item.quantity ?? 1, participants: item.participants,
          startAt: item.startAt, endAt: item.endAt, bookingReference: lead.bookingReference, status: "completed",
        })));
      }
      // LTV гостя пополняется суммой оказанных услуг.
      await db.update(s.guests).set({ lifetimeValue: ctx.folio.totalAmount > 0 ? sql`${s.guests.lifetimeValue} + ${ctx.folio.totalAmount}` : s.guests.lifetimeValue, updatedAt: timestamp })
        .where(eq(s.guests.id, lead.guestId));
      break;
    }
    case "lost":
    case "cancelled": {
      await db.update(s.leadItems).set({ status: "cancelled", updatedAt: timestamp })
        .where(and(eq(s.leadItems.leadId, lead.id), inArray(s.leadItems.status, [...OPEN_ITEM_STATUSES, "confirmed"])));
      // Фолио закрывается, но суммы сохраняются — это «упущенная выручка»
      // для отчётности по потерянным/отменённым сделкам.
      await setFolioStatus(db, folio.id, "cancelled");
      break;
    }
    default:
      break;
  }
};

export interface AdvanceResult {
  ok: boolean;
  journey: JourneyEvaluation;
  error?: string;
  blockers?: JourneyEvaluation["blockers"];
}

/** «Продолжить» — сервер сам определяет следующий этап и проверяет готовность. */
export const advanceLead = async (
  db: Database,
  leadId: string,
  employeeId: string | null | undefined,
  options: { force?: boolean } = {},
): Promise<AdvanceResult & { status: number }> => {
  const ctx = await loadJourneyContext(db, leadId);
  if (!ctx) return { ok: false, status: 404, error: "Лид не найден", journey: evaluateJourney({ stage: "new", hasGuest: false, interests: [], items: [], offers: [], folio: null }) };
  const evaluation = ctx.evaluation;
  if (evaluation.terminal || !evaluation.nextStage) {
    return { ok: false, status: 409, error: `Этап «${evaluation.currentStageLabel}» является завершающим`, journey: evaluation };
  }
  if (!evaluation.canAdvance && !options.force) {
    return { ok: false, status: 409, error: "stage_requirements_not_met", journey: evaluation, blockers: evaluation.blockers };
  }
  const target = evaluation.nextStage;
  const skippedChecklist = !evaluation.canAdvance;
  await db.transaction(async (tx) => {
    await applyStageTransition(tx, ctx, target, employeeId, skippedChecklist
      ? { comment: `Переход выполнен без заполнения чек-листа: ${evaluation.blockers.map((blocker) => blocker.label).join(", ")}` }
      : {},
    );
    if (target === "offer" || target === "confirmed" || target === "payment_pending") {
      await recalcFolio(tx, ctx.folio.id);
    }
  });
  const after = await loadJourneyContext(db, leadId);
  return { ok: true, status: 200, journey: after!.evaluation };
};

/**
 * Явный переход (старый POST /stage endpoint): валидируется против journey —
 * вперёд только на следующий этап с проверкой требований; lost требует
 * lostReason; cancelled — только из confirmed.
 */
export const transitionLead = async (
  db: Database,
  leadId: string,
  target: JourneyStage,
  employeeId: string | null | undefined,
  opts: { lostReason?: string; comment?: string } = {},
): Promise<AdvanceResult & { status: number }> => {
  const ctx = await loadJourneyContext(db, leadId);
  if (!ctx) return { ok: false, status: 404, error: "Лид не найден", journey: evaluateJourney({ stage: "new", hasGuest: false, interests: [], items: [], offers: [], folio: null }) };
  const evaluation = ctx.evaluation;
  if (target === ctx.input.stage) return { ok: true, status: 200, journey: evaluation };

  if (target === "lost") {
    if (ctx.input.stage === "completed") return { ok: false, status: 409, error: "Завершённый заказ нельзя пометить потерянным", journey: evaluation };
    if (!opts.lostReason) return { ok: false, status: 422, error: "lost_reason_required", journey: evaluation };
    await db.transaction((tx) => applyStageTransition(tx, ctx, target, employeeId, opts));
    const after = await loadJourneyContext(db, leadId);
    return { ok: true, status: 200, journey: after!.evaluation };
  }
  if (target === "cancelled") {
    if (ctx.input.stage !== "confirmed") return { ok: false, status: 409, error: "Отменить можно только подтверждённый заказ", journey: evaluation };
    await db.transaction((tx) => applyStageTransition(tx, ctx, target, employeeId, opts));
    const after = await loadJourneyContext(db, leadId);
    return { ok: true, status: 200, journey: after!.evaluation };
  }
  if (evaluation.nextStage !== target) {
    return {
      ok: false, status: 409, journey: evaluation,
      error: evaluation.nextStage
        ? `Из этапа «${evaluation.currentStageLabel}» можно перейти только в «${journeyStageLabels[evaluation.nextStage]}»`
        : `Этап «${evaluation.currentStageLabel}» является завершающим`,
    };
  }
  if (!evaluation.canAdvance) {
    return { ok: false, status: 409, error: "stage_requirements_not_met", journey: evaluation, blockers: evaluation.blockers };
  }
  await db.transaction(async (tx) => {
    await applyStageTransition(tx, ctx, target, employeeId, opts);
    if (["offer", "confirmed", "payment_pending"].includes(target)) await recalcFolio(tx, ctx.folio.id);
  });
  const after = await loadJourneyContext(db, leadId);
  return { ok: true, status: 200, journey: after!.evaluation };
};

/** Откат на предыдущий этап (отдельное действие, требует причину). */
export const rollbackLead = async (
  db: Database,
  leadId: string,
  employeeId: string | null | undefined,
  reason: string,
): Promise<AdvanceResult & { status: number }> => {
  const ctx = await loadJourneyContext(db, leadId);
  if (!ctx) return { ok: false, status: 404, error: "Лид не найден", journey: evaluateJourney({ stage: "new", hasGuest: false, interests: [], items: [], offers: [], folio: null }) };
  const stage = ctx.input.stage;
  const rollbackAllowed = ["qualified", "planning", "offer", "payment_pending", "confirmed"].includes(stage);
  if (!rollbackAllowed) {
    return { ok: false, status: 409, error: `Откат из этапа «${journeyStageLabels[stage]}» недоступен`, journey: ctx.evaluation };
  }
  const history = await db.select().from(s.leadStageHistory).where(eq(s.leadStageHistory.leadId, leadId));
  const distinct = [...new Map(history.sort((a, b) => a.changedAt.localeCompare(b.changedAt)).map((entry) => [entry.stage, entry])).values()];
  const previous = [...distinct].reverse().find((entry) => entry.stage !== stage)?.stage as JourneyStage | undefined;
  if (!previous) return { ok: false, status: 409, error: "Нет предыдущего этапа", journey: ctx.evaluation };
  const timestamp = now();
  await db.transaction(async (tx) => {
    await tx.update(s.leads).set({ stage: previous, probability: probabilityFor(previous), lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, leadId));
    await tx.insert(s.leadStageHistory).values({ id: newId("stage"), leadId, stage: previous, employeeId, changedAt: timestamp });
    await tx.insert(s.leadActivities).values({ id: newId("activity"), leadId, employeeId, type: "stage_change", title: `Возврат на этап «${journeyStageLabels[previous]}»`, description: reason, occurredAt: timestamp });
    if (previous === "planning" || previous === "qualified" || previous === "new") {
      await tx.update(s.folios).set({ status: "open", updatedAt: timestamp }).where(and(eq(s.folios.id, ctx.folio.id), ne(s.folios.status, "cancelled")));
    }
  });
  const after = await loadJourneyContext(db, leadId);
  return { ok: true, status: 200, journey: after!.evaluation };
};

/** Синхронизирует classification.direction с выбранными категориями услуг. */
export const syncClassificationDirection = async (db: DbLike, leadId: string) => {
  const interests = await db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, leadId));
  const primary = interests.find((interest) => interest.isPrimary) ?? interests[0];
  if (!primary) return;
  await db.update(s.leadClassifications).set({ direction: primary.direction, updatedAt: now() }).where(eq(s.leadClassifications.leadId, leadId));
};
