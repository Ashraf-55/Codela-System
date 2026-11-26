import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// ---------- Platform / identity ----------
export const products = sqliteTable('products', {
  slug: text('slug').primaryKey(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  status: text('status').notNull().default('active'),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const tenants = sqliteTable('tenants', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  productSlug: text('product_slug').notNull(),
  status: text('status').notNull().default('provisioning'),
  locale: text('locale').notNull().default('ar'),
  currency: text('currency').notNull().default('EGP'),
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  taxBp: integer('tax_bp').notNull().default(0), // default tax in basis points for online orders
  // Outgoing-message opt-outs set by the business: a key set to false disables that channel/kind (missing = enabled).
  notifyPrefs: text('notify_prefs', { mode: 'json' }).$type<{ email?: boolean; sms?: boolean; whatsapp?: boolean; reminders?: boolean; orders?: boolean }>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('tenants_slug_uq').on(t.slug)]);

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('ar'),
  status: text('status').notNull().default('active'),
  isPlatformStaff: integer('is_platform_staff', { mode: 'boolean' }).notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0), // consecutive failures; 5 -> locked 15 min
  lockedUntil: text('locked_until'),
  totpSecret: text('totp_secret'), // base32; set during 2FA setup, only enforced once totpEnabled
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  totpLastStep: integer('totp_last_step'), // last accepted 30 s step (replay protection)
  emailVerifiedAt: text('email_verified_at'), // set when the owner/staff member confirms the e-mail link; legacy rows are back-filled by migration 0013
  avatarFileId: text('avatar_file_id'), // files.id of the profile picture (purpose 'avatar', private, same tenant)
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const roles = sqliteTable('roles', {
  id: id(),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }), // null = platform role
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
}, (t) => [uniqueIndex('roles_tenant_name_uq').on(t.tenantId, t.name)]);

export const rolePermissions = sqliteTable('role_permissions', {
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
}, (t) => [uniqueIndex('role_perm_uq').on(t.roleId, t.permission)]);

export const memberships = sqliteTable('memberships', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('membership_uq').on(t.userId, t.tenantId), index('membership_tenant_ix').on(t.tenantId), index('membership_role_ix').on(t.roleId)]);

export const sessions = sqliteTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default('tenant'), // platform | tenant
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_ix').on(t.userId), index('sessions_tenant_ix').on(t.tenantId)]);

export const auditLogs = sqliteTable('audit_logs', {
  id: id(),
  actorId: text('actor_id'),
  tenantId: text('tenant_id'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('audit_tenant_ix').on(t.tenantId, t.createdAt)]);

// ---------- Tenant-scoped shared entities ----------
export const customers = sqliteTable('customers', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  ref: text('ref').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('customers_tenant_ref_uq').on(t.tenantId, t.ref), index('customers_tenant_ix').on(t.tenantId)]);

// ---------- Plans, subscriptions, add-ons ----------
export const plans = sqliteTable('plans', {
  id: id(),
  productSlug: text('product_slug').notNull().references(() => products.slug),
  tier: text('tier').notNull(), // starter | professional | business
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  priceMonthly: integer('price_monthly').notNull(), // minor units
  priceAnnual: integer('price_annual').notNull(),
  currency: text('currency').notNull().default('EGP'),
  trialDays: integer('trial_days').notNull().default(14),
  limits: text('limits', { mode: 'json' }).$type<Record<string, number | boolean>>().notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (t) => [uniqueIndex('plans_product_tier_uq').on(t.productSlug, t.tier)]);

export const subscriptions = sqliteTable('subscriptions', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => plans.id),
  billingPeriod: text('billing_period').notNull().default('monthly'),
  status: text('status').notNull(),
  trialEndsAt: text('trial_ends_at'),
  currentPeriodStart: text('current_period_start'),
  currentPeriodEnd: text('current_period_end'),
  graceEndsAt: text('grace_ends_at'),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
  canceledAt: text('canceled_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('subscriptions_tenant_uq').on(t.tenantId), index('subscriptions_plan_ix').on(t.planId)]);

export const subscriptionEvents = sqliteTable('subscription_events', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  subscriptionId: text('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'restrict' }),
  type: text('type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('sub_events_tenant_ix').on(t.tenantId, t.createdAt), index('sub_events_sub_ix').on(t.subscriptionId)]);

export const addOns = sqliteTable('add_ons', {
  key: text('key').primaryKey(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  description: text('description').notNull().default(''),
  priceMinor: integer('price_minor').notNull(),
  currency: text('currency').notNull().default('EGP'),
  billingType: text('billing_type').notNull(), // recurring | one_time
  compatibleProducts: text('compatible_products', { mode: 'json' }).$type<string[] | '*'>().notNull(),
  grants: text('grants', { mode: 'json' }).$type<Record<string, number | boolean>>().notNull().default({}),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const tenantAddOns = sqliteTable('tenant_add_ons', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  addOnKey: text('add_on_key').notNull().references(() => addOns.key),
  status: text('status').notNull().default('active'), // active | renewal_due | expired | canceled
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  expiresAt: text('expires_at'),         // end of the paid month for recurring add-ons; null = one-time / no expiry
  renewalDueAt: text('renewal_due_at'),  // when the renewal reminder was raised
}, (t) => [uniqueIndex('tenant_addon_uq').on(t.tenantId, t.addOnKey)]);

/** Append-only history of an add-on's lifecycle (granted, renewal_due, renewed, expired, renewal_failed, canceled). */
export const addonEvents = sqliteTable('addon_events', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  addOnKey: text('add_on_key').notNull().references(() => addOns.key),
  action: text('action').notNull(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('addon_events_tenant_ix').on(t.tenantId, t.createdAt), index('addon_events_key_ix').on(t.addOnKey)]);

/** Platform-wide announcements shown to business owners in the dashboard (managed by Super Admin). */
export const announcements = sqliteTable('announcements', {
  id: id(),
  titleAr: text('title_ar').notNull(), titleEn: text('title_en').notNull(),
  bodyAr: text('body_ar').notNull().default(''), bodyEn: text('body_en').notNull().default(''),
  level: text('level').notNull().default('info'), // info | warning | critical
  productSlug: text('product_slug'),               // null = every product
  startsAt: text('starts_at'), endsAt: text('ends_at'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by'),
  createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
}, (t) => [index('announcements_active_ix').on(t.active, t.startsAt)]);

/** Editable wording of system messages. A missing/inactive row falls back to the built-in template. */
export const notificationTemplates = sqliteTable('notification_templates', {
  id: id(),
  key: text('key').notNull(), channel: text('channel').notNull().default('email'),
  subjectAr: text('subject_ar').notNull().default(''), subjectEn: text('subject_en').notNull().default(''),
  bodyAr: text('body_ar').notNull(), bodyEn: text('body_en').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  updatedBy: text('updated_by'), updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
}, (t) => [uniqueIndex('notification_templates_key_channel_uq').on(t.key, t.channel)]);

// ---------- Search & notifications ----------
export const searchIndex = sqliteTable('search_index', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  keywords: text('keywords').notNull(), // normalized, space separated
  permissionKey: text('permission_key').notNull(),
  updatedAt: createdAt(),
}, (t) => [uniqueIndex('search_entity_uq').on(t.tenantId, t.entityType, t.entityId), index('search_tenant_ix').on(t.tenantId)]);

export const notifications = sqliteTable('notifications', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // null = whole tenant
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  readAt: text('read_at'),
  createdAt: createdAt(),
}, (t) => [index('notif_tenant_ix').on(t.tenantId, t.createdAt), index('notif_user_ix').on(t.userId)]);

// ---------- White-label site, domains, platform staff ----------
export const tenantSites = sqliteTable('tenant_sites', {
  tenantId: text('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  templateKey: text('template_key').notNull().default('classic'),
  draft: text('draft', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  published: text('published', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  publishedAt: text('published_at'),
  updatedAt: createdAt(),
});

export const domains = sqliteTable('domains', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull(),
  verifyToken: text('verify_token').notNull(),
  status: text('status').notNull().default('pending'), // pending | verified
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  sslStatus: text('ssl_status').notNull().default('not_provisioned'),
  lastCheckedAt: text('last_checked_at'),
  verifiedAt: text('verified_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('domains_hostname_uq').on(t.hostname), index('domains_tenant_ix').on(t.tenantId)]);

export const platformStaff = sqliteTable('platform_staff', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  roleName: text('role_name').notNull(),
  department: text('department').notNull().default('management'),
});

// ---------- Codela internal operations ----------
export const leads = sqliteTable('leads', {
  id: id(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  company: text('company'),
  productSlug: text('product_slug'),
  source: text('source').notNull(), // demo_request | contact | manual
  message: text('message'),
  stage: text('stage').notNull().default('new'),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: createdAt(),
}, (t) => [index('leads_stage_ix').on(t.stage), index('leads_created_ix').on(t.createdAt), index('leads_owner_ix').on(t.ownerId)]);

export const internalTasks = sqliteTable('internal_tasks', {
  id: id(),
  title: text('title').notNull(),
  description: text('description'),
  department: text('department').notNull(),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('todo'),
  dueDate: text('due_date'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('tasks_dept_ix').on(t.department, t.status), index('tasks_assignee_ix').on(t.assigneeId)]);

export const platformSettings = sqliteTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: createdAt(),
});

// ---------- Generic product records (declarative entities) ----------
// Integrity note: reference/unique/immutability rules for these records are enforced in the service layer
// (see apps/api/src/products/store.ts); only tenant ownership is a database foreign key.
export const records = sqliteTable('records', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  entityType: text('entity_type').notNull(),
  code: text('code'),
  uniqueKey: text('unique_key'),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: createdAt(),
}, (t) => [
  index('records_tenant_type_ix').on(t.tenantId, t.entityType, t.createdAt),
  uniqueIndex('records_code_uq').on(t.tenantId, t.entityType, t.code),
  uniqueIndex('records_unique_uq').on(t.tenantId, t.entityType, t.uniqueKey),
]);

export const counters = sqliteTable('counters', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => [uniqueIndex('counters_uq').on(t.tenantId, t.key)]);

// ---------- Real billing records (gateway boundary) ----------
export const billingInvoices = sqliteTable('billing_invoices', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  number: text('number').notNull(),
  subscriptionId: text('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => plans.id),
  billingPeriod: text('billing_period').notNull(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(), // minor units
  currency: text('currency').notNull(),
  status: text('status').notNull().default('issued'), // issued | paid | void
  issuedAt: text('issued_at').notNull(),
  paidAt: text('paid_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('billing_invoice_number_uq').on(t.number), index('billing_invoice_tenant_ix').on(t.tenantId, t.createdAt), index('billing_invoice_sub_ix').on(t.subscriptionId), index('billing_invoice_plan_ix').on(t.planId)]);

export const paymentTransactions = sqliteTable('payment_transactions', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  invoiceId: text('invoice_id').notNull().references(() => billingInvoices.id, { onDelete: 'restrict' }),
  gateway: text('gateway').notNull(),
  providerRef: text('provider_ref').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull().default('pending'), // pending | succeeded | failed | refunded
  simulated: integer('simulated', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payment_tx_idem_uq').on(t.idempotencyKey), uniqueIndex('payment_tx_ref_uq').on(t.gateway, t.providerRef), index('payment_tx_tenant_ix').on(t.tenantId), index('payment_tx_invoice_ix').on(t.invoiceId)]);

// ---------- Manual payments (InstaPay / Vodafone Cash): receipt submitted by the tenant, approved or rejected by Codela staff ----------
export const manualPayments = sqliteTable('manual_payments', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  transactionId: text('transaction_id').notNull().references(() => paymentTransactions.id, { onDelete: 'restrict' }),
  invoiceId: text('invoice_id').notNull().references(() => billingInvoices.id, { onDelete: 'restrict' }),
  method: text('method').notNull(), // instapay | vodafone_cash
  reference: text('reference').notNull(), // transfer reference exactly as typed by the customer
  referenceNorm: text('reference_norm').notNull(), // lower-cased, whitespace-collapsed: used for duplicate detection
  payerName: text('payer_name'),
  amount: integer('amount').notNull(), // expected amount in minor units, snapshotted from the plan at submission
  currency: text('currency').notNull(),
  billingPeriod: text('billing_period').notNull(),
  receiptFileId: text('receipt_file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  receiptSha256: text('receipt_sha256').notNull(),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  submittedBy: text('submitted_by').notNull(),
  reviewedBy: text('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  reviewNote: text('review_note'),
  kind: text('kind').notNull().default('plan'), // plan | addon
  targetPlanId: text('target_plan_id').references(() => plans.id), // plan the customer is paying for (applied only on approval)
  addOnKey: text('add_on_key').references(() => addOns.key), // add-on being bought (activated only on approval)
  createdAt: createdAt(),
}, (t) => [
  index('manual_pay_target_plan_ix').on(t.targetPlanId), index('manual_pay_addon_ix').on(t.addOnKey),
  uniqueIndex('manual_pay_ref_uq').on(t.method, t.referenceNorm).where(sql`status <> 'rejected'`),
  uniqueIndex('manual_pay_receipt_uq').on(t.receiptSha256).where(sql`status <> 'rejected'`),
  uniqueIndex('manual_pay_tx_uq').on(t.transactionId),
  index('manual_pay_tenant_ix').on(t.tenantId, t.createdAt),
  index('manual_pay_status_ix').on(t.status, t.createdAt),
  index('manual_pay_invoice_ix').on(t.invoiceId),
  index('manual_pay_receipt_file_ix').on(t.receiptFileId),
]);

export const webhookEvents = sqliteTable('webhook_events', {
  id: id(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  processedAt: createdAt(),
}, (t) => [uniqueIndex('webhook_event_uq').on(t.provider, t.eventId)]);

// ---------- Outbound messages (email / SMS / WhatsApp) ----------
export const notificationOutbox = sqliteTable('notification_outbox', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // email | sms | whatsapp
  toAddr: text('to_addr').notNull(),
  template: text('template').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('queued'), // queued | sent | delivered | read | failed | no_provider | not_entitled | opted_out
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: text('sent_at'),
  providerId: text('provider_id'), // message id returned by the provider; delivery receipts are matched on it
  createdAt: createdAt(),
}, (t) => [index('outbox_tenant_ix').on(t.tenantId, t.createdAt), index('outbox_provider_ix').on(t.providerId)]);

// ---------- End-customer / student PORTAL accounts (distinct from CRM `customers` records and from staff `users`; scoped to ONE tenant) ----------
export const portalAccounts = sqliteTable('portal_accounts', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('ar'),
  status: text('status').notNull().default('active'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: text('locked_until'),
  avatarFileId: text('avatar_file_id'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('portal_accounts_tenant_email_uq').on(t.tenantId, t.email)]);

export const portalSessions = sqliteTable('portal_sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull(),
  accountId: text('account_id').notNull().references(() => portalAccounts.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('portal_sessions_token_uq').on(t.tokenHash), index('portal_sessions_account_ix').on(t.accountId), index('portal_sessions_tenant_ix').on(t.tenantId)]);

// ---------- Uploaded files (metadata; bytes live on disk under UPLOAD_DIR/<tenantId>/<storageKey>) ----------
export const files = sqliteTable('files', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerUserId: text('owner_user_id'),
  purpose: text('purpose').notNull(), // avatar | logo | product | document | medical | education
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  visibility: text('visibility').notNull().default('private'), // private | public (public = images only: logo/product)
  entityType: text('entity_type'), // optional attachment link: the record this file belongs to (verified to be in the same tenant at upload)
  entityId: text('entity_id'),
  createdAt: createdAt(),
}, (t) => [index('files_tenant_ix').on(t.tenantId, t.createdAt), index('files_entity_ix').on(t.tenantId, t.entityType, t.entityId), uniqueIndex('files_key_uq').on(t.storageKey)]);
