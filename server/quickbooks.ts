import crypto from "crypto";
import { db } from "./db";
import { eq, and, lte, inArray, sql as dsql } from "drizzle-orm";
import {
  qboConfig, qboCategoryMapping, qboSyncLog,
  orderItems, payments, orders, categories,
  type QboConfig,
} from "@shared/schema";
import * as storage from "./storage";

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || "";
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || "";
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || "";
const QBO_ENVIRONMENT = process.env.QBO_ENVIRONMENT || "sandbox";
const QBO_ENCRYPT_KEY = process.env.QBO_ENCRYPT_KEY || "";

const QBO_BASE_URL = QBO_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  if (!QBO_ENCRYPT_KEY) throw new Error("QBO_ENCRYPT_KEY not configured");
  const key = Buffer.from(QBO_ENCRYPT_KEY, "hex");
  if (key.length !== 16) {
    const key32 = crypto.createHash("sha256").update(QBO_ENCRYPT_KEY).digest();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key32, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  }
  const key32 = crypto.createHash("sha256").update(QBO_ENCRYPT_KEY).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key32, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(text: string): string {
  if (!QBO_ENCRYPT_KEY) throw new Error("QBO_ENCRYPT_KEY not configured");
  const key32 = crypto.createHash("sha256").update(QBO_ENCRYPT_KEY).digest();
  const parts = text.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, key32, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function getQboConfig(): Promise<QboConfig | null> {
  const [row] = await db.select().from(qboConfig).limit(1);
  return row || null;
}

async function upsertQboConfig(data: Partial<QboConfig>) {
  const existing = await getQboConfig();
  if (existing) {
    await db.update(qboConfig).set(data).where(eq(qboConfig.id, existing.id));
  } else {
    await db.insert(qboConfig).values(data as any);
  }
}

export function getAuthUrl(): string {
  const scopes = "com.intuit.quickbooks.accounting";
  const state = crypto.randomBytes(8).toString("hex");
  const authBase = QBO_ENVIRONMENT === "production"
    ? "https://appcenter.intuit.com/connect/oauth2"
    : "https://appcenter.intuit.com/connect/oauth2";
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    scope: scopes,
    redirect_uri: QBO_REDIRECT_URI,
    response_type: "code",
    state,
  });
  return `${authBase}?${params.toString()}`;
}

async function exchangeToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number }> {
  const credentials = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: QBO_REDIRECT_URI,
    }).toString(),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OAuth token exchange failed: ${res.status} ${errBody}`);
  }
  return res.json();
}

export async function handleOAuthCallback(code: string, realmId: string): Promise<void> {
  const tokenData = await exchangeToken(code);
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await upsertQboConfig({
    accessToken: encrypt(tokenData.access_token),
    refreshToken: encrypt(tokenData.refresh_token),
    realmId,
    tokenExpiresAt: expiresAt,
    isConnected: true,
    connectedAt: new Date(),
    lastTokenRefresh: new Date(),
  });
}

export async function ensureFreshToken(): Promise<string> {
  const config = await getQboConfig();
  if (!config || !config.isConnected || !config.refreshToken) {
    throw new Error("QBO not connected");
  }

  const now = new Date();
  const expiresAt = config.tokenExpiresAt ? new Date(config.tokenExpiresAt) : new Date(0);
  const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (expiresAt > fiveMinFromNow && config.accessToken) {
    return decrypt(config.accessToken);
  }

  const refreshToken = decrypt(config.refreshToken);
  const credentials = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[QBO] Token refresh failed:", errBody);
    await upsertQboConfig({ isConnected: false });
    throw new Error("QBO token refresh failed — reconnect required");
  }

  const tokenData = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await upsertQboConfig({
    accessToken: encrypt(tokenData.access_token),
    refreshToken: encrypt(tokenData.refresh_token),
    tokenExpiresAt: newExpiresAt,
    lastTokenRefresh: new Date(),
  });

  return tokenData.access_token;
}

async function qboApiGet(path: string): Promise<any> {
  const config = await getQboConfig();
  if (!config?.realmId) throw new Error("QBO realmId not configured");
  const token = await ensureFreshToken();
  const url = `${QBO_BASE_URL}/v3/company/${config.realmId}${path}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`QBO API GET ${path} failed: ${res.status} ${errBody}`);
  }
  return res.json();
}

async function qboApiPost(path: string, body: any): Promise<any> {
  const config = await getQboConfig();
  if (!config?.realmId) throw new Error("QBO realmId not configured");
  const token = await ensureFreshToken();
  const url = `${QBO_BASE_URL}/v3/company/${config.realmId}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`QBO API POST ${path} failed: ${res.status} ${errBody}`);
  }
  return res.json();
}

export async function getQBOItems(): Promise<{ id: string; name: string; type: string }[]> {
  const data = await qboApiGet("/query?query=" + encodeURIComponent("SELECT * FROM Item WHERE Active = true MAXRESULTS 1000"));
  const items = data?.QueryResponse?.Item || [];
  return items.map((i: any) => ({ id: String(i.Id), name: i.Name, type: i.Type }));
}

export async function getQBOAccounts(): Promise<{ id: string; name: string; accountType: string }[]> {
  const data = await qboApiGet("/query?query=" + encodeURIComponent("SELECT * FROM Account WHERE Active = true AND AccountType IN ('Bank', 'Other Current Asset') MAXRESULTS 500"));
  const accts = data?.QueryResponse?.Account || [];
  return accts.map((a: any) => ({ id: String(a.Id), name: a.Name, accountType: a.AccountType }));
}

export async function getQBOTaxCodes(): Promise<{ id: string; name: string; rate: number }[]> {
  const data = await qboApiGet("/query?query=" + encodeURIComponent("SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 100"));
  const codes = data?.QueryResponse?.TaxCode || [];
  return codes.map((t: any) => ({ id: String(t.Id), name: t.Name, rate: 0 }));
}

async function findOrCreateCustomer(name: string): Promise<string> {
  const data = await qboApiGet("/query?query=" + encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${name}' MAXRESULTS 1`));
  const existing = data?.QueryResponse?.Customer;
  if (existing && existing.length > 0) return String(existing[0].Id);

  const created = await qboApiPost("/customer", { DisplayName: name });
  return String(created.Customer.Id);
}

function getDepositAccountForMethod(config: QboConfig, paymentCode: string): string | null {
  const code = paymentCode.toUpperCase();
  if (code.includes("CASH") || code.includes("EFECT")) return config.depositAccountCash || null;
  if (code.includes("CARD") || code.includes("TARJ")) return config.depositAccountCard || null;
  if (code.includes("SINPE")) return config.depositAccountSinpe || null;
  return config.depositAccountCard || null;
}

export async function createSalesReceipt(orderId: number, paymentId: number): Promise<string> {
  const existingLog = await db.select().from(qboSyncLog)
    .where(and(eq(qboSyncLog.paymentId, paymentId), eq(qboSyncLog.status, "SUCCESS")))
    .limit(1);
  if (existingLog.length > 0) return existingLog[0].qboReceiptId || "";

  const config = await getQboConfig();
  if (!config || !config.isConnected) throw new Error("QBO not connected");

  const order = await storage.getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const items = await storage.getOrderItems(orderId);
  const activeItems = items.filter(i => i.status !== "VOIDED");

  const payment = await storage.getPayment(paymentId);
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const pm = await storage.getPaymentMethod(payment.paymentMethodId);

  const mappings = await db.select().from(qboCategoryMapping);
  const mappingMap = new Map(mappings.map(m => [m.categoryId, m]));

  const allProducts = await db.select({
    id: dsql`"products"."id"`,
    categoryId: dsql`"products"."category_id"`,
  }).from(dsql`products`);
  const productCatMap = new Map<number, number>();
  for (const p of allProducts) {
    if (p.categoryId) productCatMap.set(Number(p.id), Number(p.categoryId));
  }

  const grouped = new Map<string, { qboItemId: string; amount: number }>();
  for (const item of activeItems) {
    const productId = (item as any).productId;
    const catId = productId ? productCatMap.get(productId) : null;
    const mapping = catId ? mappingMap.get(catId) : null;
    const qboItemId = mapping?.qboItemId || null;

    if (!qboItemId) {
      console.warn(`[QBO] Item "${item.productNameSnapshot}" has no QBO mapping (catId=${catId}), skipping`);
      continue;
    }

    const modifiers = await storage.getOrderItemModifiers(item.id);
    const modDelta = modifiers.reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot || 0) * (m.qty || 1), 0);
    const lineTotal = (Number(item.productPriceSnapshot) + modDelta) * item.qty;

    const existing = grouped.get(qboItemId);
    if (existing) {
      existing.amount += lineTotal;
    } else {
      grouped.set(qboItemId, { qboItemId, amount: lineTotal });
    }
  }

  const lines: any[] = [];
  let lineNum = 1;
  grouped.forEach((group) => {
    lines.push({
      LineNum: lineNum++,
      Amount: Math.round(group.amount * 100) / 100,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: group.qboItemId },
        Qty: 1,
        UnitPrice: Math.round(group.amount * 100) / 100,
        TaxCodeRef: config.taxCodeRef ? { value: config.taxCodeRef } : undefined,
      },
    });
  });

  const discountRows = await storage.getOrderItemDiscountsByOrder(orderId);
  const totalDiscounts = discountRows.reduce((s: number, d: any) => s + Number(d.amountApplied), 0);
  if (totalDiscounts > 0) {
    lines.push({
      LineNum: lineNum++,
      Amount: Math.round(totalDiscounts * 100) / 100,
      DetailType: "DiscountLineDetail",
      DiscountLineDetail: {
        PercentBased: false,
        DiscountPercent: 0,
      },
    });
  }

  const customerId = await findOrCreateCustomer("Cliente Mostrador");
  const depositAccount = pm ? getDepositAccountForMethod(config, pm.paymentCode) : null;

  const orderNum = order.globalNumber ? `G-${order.globalNumber}` : (order.dailyNumber ? `D-${order.dailyNumber}` : `${order.id}`);

  const receiptBody: any = {
    Line: lines,
    CustomerRef: { value: customerId },
    TxnDate: order.businessDate || new Date().toISOString().split("T")[0],
    DocNumber: orderNum,
    PrivateNote: `RMS Order #${orderNum}`,
  };

  if (depositAccount) {
    receiptBody.DepositToAccountRef = { value: depositAccount };
  }

  try {
    const result = await qboApiPost("/salesreceipt", receiptBody);
    const receipt = result.SalesReceipt;
    const qboId = String(receipt.Id);
    const qboDocNum = receipt.DocNumber || "";

    await db.update(qboSyncLog).set({
      status: "SUCCESS",
      qboReceiptId: qboId,
      qboReceiptNumber: qboDocNum,
      syncedAt: new Date(),
      errorMessage: null,
      attempts: dsql`${qboSyncLog.attempts} + 1`,
    }).where(eq(qboSyncLog.paymentId, paymentId));

    return qboId;
  } catch (err: any) {
    const backoffMinutes = [5, 15, 60, 240, 1440];
    const logEntry = await db.select().from(qboSyncLog).where(eq(qboSyncLog.paymentId, paymentId)).limit(1);
    const attempts = logEntry[0]?.attempts || 0;
    const nextRetry = new Date(Date.now() + (backoffMinutes[Math.min(attempts, backoffMinutes.length - 1)] * 60 * 1000));

    await db.update(qboSyncLog).set({
      status: "FAILED",
      errorMessage: err.message?.substring(0, 500),
      attempts: dsql`${qboSyncLog.attempts} + 1`,
      nextRetryAt: nextRetry,
    }).where(eq(qboSyncLog.paymentId, paymentId));

    throw err;
  }
}

export async function voidSalesReceipt(paymentId: number): Promise<void> {
  const [logEntry] = await db.select().from(qboSyncLog)
    .where(and(eq(qboSyncLog.paymentId, paymentId), eq(qboSyncLog.status, "SUCCESS")))
    .limit(1);

  if (!logEntry || !logEntry.qboReceiptId) return;

  try {
    const receiptData = await qboApiGet(`/salesreceipt/${logEntry.qboReceiptId}`);
    const receipt = receiptData.SalesReceipt;

    await qboApiPost("/salesreceipt?operation=void", {
      Id: receipt.Id,
      SyncToken: receipt.SyncToken,
    });

    await db.update(qboSyncLog).set({
      status: "VOIDED",
      syncedAt: new Date(),
    }).where(eq(qboSyncLog.id, logEntry.id));
  } catch (err: any) {
    console.error(`[QBO] Failed to void receipt for payment ${paymentId}:`, err.message);
  }
}

export async function retryPendingSync(): Promise<number> {
  const config = await getQboConfig();
  if (!config || !config.isConnected) return 0;

  const now = new Date();
  const pendingLogs = await db.select().from(qboSyncLog)
    .where(
      dsql`(${qboSyncLog.status} = 'PENDING') OR (${qboSyncLog.status} = 'FAILED' AND ${qboSyncLog.nextRetryAt} <= ${now} AND ${qboSyncLog.attempts} < 5)`
    )
    .limit(20);

  let processed = 0;
  for (const log of pendingLogs) {
    try {
      await createSalesReceipt(log.orderId, log.paymentId);
      processed++;
    } catch (err: any) {
      console.error(`[QBO] Retry failed for payment ${log.paymentId}:`, err.message);
    }
  }
  return processed;
}

export async function enqueueSyncForPayment(paymentId: number, orderId: number): Promise<void> {
  const config = await getQboConfig();
  if (!config || !config.isConnected) return;

  const payment = await storage.getPayment(paymentId);
  if (!payment) return;
  if ((payment as any).origin === "LOYVERSE") return;

  if (config.syncFromDate && payment.businessDate < config.syncFromDate) return;

  await db.insert(qboSyncLog).values({
    paymentId,
    orderId,
    status: "PENDING",
  }).onConflictDoNothing();

  createSalesReceipt(orderId, paymentId)
    .catch(err => console.error("[QBO] Sync failed, will retry:", err.message));
}

export async function disconnectQBO(): Promise<void> {
  const config = await getQboConfig();
  if (!config) return;
  await db.update(qboConfig).set({
    accessToken: null,
    refreshToken: null,
    realmId: null,
    tokenExpiresAt: null,
    isConnected: false,
  }).where(eq(qboConfig.id, config.id));
}

export async function updateQboSettings(data: {
  depositAccountCash?: string;
  depositAccountCard?: string;
  depositAccountSinpe?: string;
  taxCodeRef?: string;
  syncFromDate?: string;
}): Promise<void> {
  await upsertQboConfig(data as any);
}

export async function getMappings(): Promise<any[]> {
  const allCats = await storage.getAllCategories();
  const mappings = await db.select().from(qboCategoryMapping);
  const mappingMap = new Map(mappings.map(m => [m.categoryId, m]));

  return allCats.map(cat => ({
    categoryId: cat.id,
    categoryName: cat.name,
    qboItemId: mappingMap.get(cat.id)?.qboItemId || null,
    qboItemName: mappingMap.get(cat.id)?.qboItemName || null,
  }));
}

export async function saveMappings(mappingsData: { categoryId: number; qboItemId: string; qboItemName: string }[]): Promise<void> {
  for (const m of mappingsData) {
    const [existing] = await db.select().from(qboCategoryMapping)
      .where(eq(qboCategoryMapping.categoryId, m.categoryId)).limit(1);
    if (existing) {
      await db.update(qboCategoryMapping).set({
        qboItemId: m.qboItemId,
        qboItemName: m.qboItemName,
        updatedAt: new Date(),
      }).where(eq(qboCategoryMapping.id, existing.id));
    } else {
      await db.insert(qboCategoryMapping).values({
        categoryId: m.categoryId,
        qboItemId: m.qboItemId,
        qboItemName: m.qboItemName,
      });
    }
  }
}

export async function getSyncLog(status?: string, limit = 50, offset = 0): Promise<any[]> {
  let query = db.select().from(qboSyncLog).orderBy(dsql`${qboSyncLog.createdAt} DESC`).limit(limit).offset(offset);
  if (status) {
    return db.select().from(qboSyncLog)
      .where(eq(qboSyncLog.status, status))
      .orderBy(dsql`${qboSyncLog.createdAt} DESC`)
      .limit(limit).offset(offset);
  }
  return query;
}

export async function getSyncStats(): Promise<{ successToday: number; pending: number; failed: number; lastSuccess: Date | null }> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const [successToday] = await db.select({ count: dsql<number>`count(*)::int` })
    .from(qboSyncLog)
    .where(and(
      eq(qboSyncLog.status, "SUCCESS"),
      dsql`${qboSyncLog.syncedAt}::date = ${todayStr}`
    ));

  const [pending] = await db.select({ count: dsql<number>`count(*)::int` })
    .from(qboSyncLog).where(eq(qboSyncLog.status, "PENDING"));

  const [failed] = await db.select({ count: dsql<number>`count(*)::int` })
    .from(qboSyncLog).where(eq(qboSyncLog.status, "FAILED"));

  const [lastSuccess] = await db.select({ syncedAt: qboSyncLog.syncedAt })
    .from(qboSyncLog).where(eq(qboSyncLog.status, "SUCCESS"))
    .orderBy(dsql`${qboSyncLog.syncedAt} DESC`).limit(1);

  return {
    successToday: successToday?.count || 0,
    pending: pending?.count || 0,
    failed: failed?.count || 0,
    lastSuccess: lastSuccess?.syncedAt || null,
  };
}

export async function initialSync(fromDate: string): Promise<number> {
  const config = await getQboConfig();
  if (!config || !config.isConnected) throw new Error("QBO not connected");

  const existingSuccess = await db.select({ paymentId: qboSyncLog.paymentId })
    .from(qboSyncLog).where(eq(qboSyncLog.status, "SUCCESS"));
  const successIds = new Set(existingSuccess.map(e => e.paymentId));

  const eligiblePayments = await db.select({
    id: payments.id,
    orderId: payments.orderId,
  }).from(payments).where(
    and(
      dsql`${payments.status} = 'PAID'`,
      dsql`${payments.businessDate} >= ${fromDate}`,
    )
  );

  const systemPayments = [];
  for (const p of eligiblePayments) {
    if (successIds.has(p.id)) continue;
    systemPayments.push(p);
  }

  let queued = 0;
  for (const p of systemPayments) {
    try {
      await db.insert(qboSyncLog).values({
        paymentId: p.id,
        orderId: p.orderId,
        status: "PENDING",
      }).onConflictDoNothing();
      queued++;
    } catch {}
  }

  return queued;
}
