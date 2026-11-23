/**
 * Staff roles and what each may do in the CRM. One catalog for the server (enforcement) and the UI
 * (hiding actions the user cannot take). The server is the authority; the UI only mirrors it.
 *
 * Property scope is separate from permissions: a user acts only inside the properties linked to
 * their employee record (`employee_properties`). `admin` and `owner` see every property of the
 * organization.
 */
export const STAFF_ROLES = [
  "admin", "owner", "property_manager", "sales_head", "sales_manager", "front_desk", "service_staff",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Администратор",
  owner: "Владелец",
  property_manager: "Управляющий",
  sales_head: "Руководитель отдела продаж",
  sales_manager: "Менеджер по продажам",
  front_desk: "Ресепшен",
  service_staff: "Сотрудник услуг",
};

export const PERMISSIONS = [
  /** See every chat of the user's properties, not only own and unassigned ones. */
  "inbox.view_all",
  /** Reply to guests and send templates in chats the user may see. */
  "inbox.reply",
  /** Take an unassigned chat. */
  "inbox.take",
  /** Assign any chat, run distribution, transfer a colleague's chats, switch a colleague's availability. */
  "inbox.assign",
  /** Receives chats from automatic distribution while available. */
  "inbox.receive",
  /** Move a request to "won" by hand (people decide; the AI hands these cases over). */
  "leads.close",
  /** Special prices: 100% discount, complimentary, barter, chef's / marketing discounts. */
  "pricing.special",
  /** Team-wide sales and commission reports; without it a manager sees only own figures. */
  "reports.team",
  /** Edit message templates, urgent keywords, distribution shift. */
  "settings.manage",
  /** Create and block staff accounts, reset passwords, change roles. */
  "users.manage",
  /** Connect messaging channels and read their diagnostics. */
  "channels.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Admins and owners can do everything but are not in the chat rotation: chats go to the sales line. */
const ALL_BUT_ROTATION = PERMISSIONS.filter((permission) => permission !== "inbox.receive");
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: ALL_BUT_ROTATION,
  owner: ALL_BUT_ROTATION,
  property_manager: ["inbox.view_all", "inbox.reply", "inbox.take", "inbox.assign", "leads.close", "pricing.special",
    "reports.team", "settings.manage", "channels.manage"],
  sales_head: ["inbox.view_all", "inbox.reply", "inbox.take", "inbox.assign", "inbox.receive", "leads.close",
    "pricing.special", "reports.team", "settings.manage"],
  sales_manager: ["inbox.reply", "inbox.take", "inbox.receive", "leads.close", "pricing.special"],
  front_desk: ["inbox.view_all", "inbox.reply", "inbox.take", "leads.close", "pricing.special"],
  service_staff: ["inbox.reply", "inbox.take"],
};

/** Roles that see every property of the organization regardless of employee links. */
export const ORGANIZATION_WIDE_ROLES: readonly StaffRole[] = ["admin", "owner"];

/** Legacy role values written before roles existed; they keep working with the closest new role. */
const LEGACY_ROLES: Record<string, StaffRole> = { sales: "sales_manager", manager: "sales_manager" };

export const normalizeRole = (role: string | null | undefined): StaffRole | null => {
  if (!role) return null;
  if ((STAFF_ROLES as readonly string[]).includes(role)) return role as StaffRole;
  return LEGACY_ROLES[role] ?? null;
};

export const permissionsOf = (role: string | null | undefined): Set<Permission> =>
  new Set(ROLE_PERMISSIONS[normalizeRole(role) ?? "service_staff"] ?? []);

export const can = (role: string | null | undefined, permission: Permission) => permissionsOf(role).has(permission);

/** Password rules for staff accounts (also shown in the UI). */
export const PASSWORD_MIN_LENGTH = 10;
export const passwordProblem = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH) return `Не короче ${PASSWORD_MIN_LENGTH} символов`;
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) return "Нужны буквы и цифры";
  return null;
};
