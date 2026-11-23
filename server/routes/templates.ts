import { randomUUID } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import { accessOf, assertPermission, assertProperty } from "../auth/access.js";
import { audit } from "../services/audit.js";
import { renderTemplate, TEMPLATE_VARIABLES, templateContext, templatesFor } from "../services/message-templates.js";
import { sendConversationMessage } from "../services/outbound-messaging.js";
import { serviceWindowOpen } from "../meta/graph.js";

const templateBody = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,60}$/), category: z.enum(["service", "sales", "payment", "stay", "other"]),
  title: z.string().trim().min(2).max(120), body: z.string().trim().max(4000), language: z.string().trim().min(2).max(8).default("ru"),
  action: z.enum(["offer", "payment_request"]).nullable().optional(),
  waTemplateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/).nullable().optional(), waTemplateLanguage: z.string().trim().max(10).nullable().optional(),
  waTemplateParams: z.array(z.enum(TEMPLATE_VARIABLES)).max(10).default([]),
  waStatus: z.enum(["not_submitted", "pending", "approved", "rejected"]).default("not_submitted"),
  active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(1000).default(100),
});

/**
 * Message templates: the same texts the AI uses, sent by a person with one click from any chat.
 * A template is rendered for the chat (guest, booking, property); a missing value blocks sending
 * instead of reaching the guest as "{{...}}". Outside WhatsApp's 24-hour window the approved
 * Meta template with the same meaning goes out instead of free text.
 */
export const createTemplatesRouter = (db: Database, config: Pick<AppConfig, "AGENT_OUTBOUND_WEBHOOK_URL" | "AGENT_OUTBOUND_WEBHOOK_TOKEN" | "WHATSAPP_OUTBOUND_WEBHOOK_URL" | "WHATSAPP_OUTBOUND_WEBHOOK_TOKEN">) => {
  const router = Router();

  router.get("/message-templates", async (request, response) => {
    const access = accessOf(request);
    const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(request.query);
    assertProperty(access, propertyId);
    response.json({ templates: await templatesFor(db, propertyId, { includeInactive: access.permissions.has("settings.manage") }), variables: TEMPLATE_VARIABLES });
  });

  router.get("/conversations/:id/templates", async (request, response) => {
    const access = accessOf(request);
    const context = await templateContext(db, request.params.id, access.employeeId);
    if (!context) return response.status(404).json({ error: "Диалог не найден" });
    const window = serviceWindowOpen(context.conversation.lastInboundAt);
    const templates = await templatesFor(db, context.conversation.propertyId);
    response.json({ windowOpen: window, channel: context.conversation.channel, templates: templates.map((template) => {
      const rendered = template.action ? { text: "", missing: [] } : renderTemplate(template.body, context.values);
      return { id: template.id, key: template.key, title: template.title, category: template.category, action: template.action,
        text: rendered.text, missing: rendered.missing, hasMetaTemplate: Boolean(template.waTemplateName && template.waStatus === "approved") };
    }) });
  });

  router.post("/conversations/:id/templates/:templateId/send", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "inbox.reply");
    if (!access.employeeId) return response.status(400).json({ error: "У пользователя нет сотрудника" });
    const { text: edited } = z.object({ text: z.string().trim().max(4000).optional() }).parse(request.body ?? {});
    const context = await templateContext(db, request.params.id, access.employeeId);
    if (!context) return response.status(404).json({ error: "Диалог не найден" });
    const { conversation, values } = context;
    if (["telegram", "whatsapp", "instagram", "simulator"].includes(conversation.channel) && conversation.automationMode !== "human")
      return response.status(409).json({ error: "Сначала возьмите диалог в работу" });
    const template = (await templatesFor(db, conversation.propertyId)).find((item) => item.id === request.params.templateId);
    if (!template || template.action) return response.status(404).json({ error: "Шаблон не найден" });
    const rendered = renderTemplate(edited || template.body, values);
    if (rendered.missing.length) return response.status(422).json({ error: `Не хватает данных: ${rendered.missing.join(", ")}`, missing: rendered.missing });
    const approvedMeta = Boolean(template.waTemplateName && template.waStatus === "approved");
    const params = template.waTemplateParams.map((name) => values[name] ?? "");
    const useMeta = approvedMeta && conversation.channel === "whatsapp" && !serviceWindowOpen(conversation.lastInboundAt) && params.every(Boolean);
    const timestamp = new Date().toISOString();
    const [message] = await db.insert(s.messages).values({ id: `message_${randomUUID()}`, conversationId: conversation.id, direction: "out",
      employeeId: access.employeeId, text: rendered.text, sentAt: timestamp, senderType: "human", deliveryStatus: "pending", templateKey: template.key,
      metadata: { templateId: template.id, ...(useMeta ? { waTemplate: { name: template.waTemplateName, language: template.waTemplateLanguage ?? template.language, params } } : {}) },
    }).returning();
    await db.update(s.conversations).set({ unreadCount: 0, lastMessageAt: timestamp, status: "pending",
      firstResponseAt: conversation.firstResponseAt ?? timestamp, updatedAt: timestamp }).where(eq(s.conversations.id, conversation.id));
    const delivery = await sendConversationMessage(db, message!.id, {
      webhookUrl: config.AGENT_OUTBOUND_WEBHOOK_URL, webhookToken: config.AGENT_OUTBOUND_WEBHOOK_TOKEN,
      whatsappWebhookUrl: config.WHATSAPP_OUTBOUND_WEBHOOK_URL, whatsappWebhookToken: config.WHATSAPP_OUTBOUND_WEBHOOK_TOKEN });
    await audit(db, access, { propertyId: conversation.propertyId, entityType: "conversation", entityId: conversation.id, action: "template_sent",
      details: { templateKey: template.key, viaMetaTemplate: useMeta, sent: delivery.sent } });
    const [stored] = await db.select().from(s.messages).where(eq(s.messages.id, message!.id)).limit(1);
    response.status(delivery.sent ? 201 : 502).json({ message: stored, delivery });
  });

  router.post("/message-templates", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "settings.manage");
    const body = templateBody.extend({ propertyId: z.string().min(1) }).parse(request.body);
    assertProperty(access, body.propertyId);
    const [created] = await db.insert(s.messageTemplates).values({ id: `template_${randomUUID()}`, ...body, updatedBy: access.employeeId })
      .onConflictDoNothing().returning();
    if (!created) return response.status(409).json({ error: "Шаблон с таким ключом уже есть на объекте" });
    await audit(db, access, { propertyId: body.propertyId, entityType: "message_template", entityId: created.id, action: "create", details: { key: body.key } });
    response.status(201).json(created);
  });

  /**
   * Editing a default template at a property creates the property's own copy with the same key, so
   * other properties keep the default.
   */
  router.put("/message-templates/:id", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "settings.manage");
    const { propertyId, ...body } = templateBody.partial().extend({ propertyId: z.string().min(1) }).parse(request.body);
    assertProperty(access, propertyId);
    const [current] = await db.select().from(s.messageTemplates).where(eq(s.messageTemplates.id, request.params.id)).limit(1);
    if (!current || (current.propertyId && current.propertyId !== propertyId)) return response.status(404).json({ error: "Шаблон не найден" });
    const at = new Date().toISOString();
    const saved = current.propertyId
      ? (await db.update(s.messageTemplates).set({ ...body, key: current.key, updatedBy: access.employeeId, updatedAt: at })
        .where(eq(s.messageTemplates.id, current.id)).returning())[0]
      : (await db.insert(s.messageTemplates).values({ ...current, ...body, key: current.key, id: `template_${randomUUID()}`, propertyId,
        updatedBy: access.employeeId, createdAt: at, updatedAt: at }).returning())[0];
    await audit(db, access, { propertyId, entityType: "message_template", entityId: saved!.id, action: "update", details: { key: current.key } });
    response.json(saved);
  });

  return router;
};
