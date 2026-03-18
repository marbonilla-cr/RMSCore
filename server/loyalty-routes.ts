import { db, pool } from "./db";
import { customers, loyaltyAccounts, loyaltyEvents, loyaltyConfig, orders } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { verifyGoogleToken, findOrCreateCustomer } from "./loyalty-auth";

function resolveTenantId(req: any): number | null {
  return req.tenantId ||
    parseInt(req.headers["x-tenant-id"] as string) ||
    parseInt(req.body?.tenantId) ||
    null;
}

function getTenantId(req: any): number {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw Object.assign(new Error("tenantId requerido"), { status: 400 });
  return tenantId;
}

export function registerLoyaltyRoutes(app: any) {

  // POST /auth/google-callback — Google Identity Services redirect mode callback
  // Google POSTs here with form-encoded body: { credential, g_csrf_token }
  app.post("/auth/google-callback", async (req: any, res: any) => {
    try {
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      if (!googleClientId || googleClientId === "pending") {
        return res.redirect("/?error=oauth_not_configured");
      }
      const credential = req.body?.credential;
      if (!credential) return res.redirect("/?error=no_credential");

      const googleData = await verifyGoogleToken(credential);
      const customer = await findOrCreateCustomer(googleData);
      const token = Buffer.from(JSON.stringify({
        customerId: customer.id,
        email: customer.email,
        name: customer.name,
        photoUrl: customer.photoUrl,
      })).toString("base64");

      res.redirect(`/?login_success=1&token=${encodeURIComponent(token)}`);
    } catch (err: any) {
      res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
  });

  // POST /api/loyalty/auth/google
  app.post("/api/loyalty/auth/google", async (req: any, res: any) => {
    try {
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      if (!googleClientId || googleClientId === "pending") {
        return res.status(503).json({ message: "Google OAuth no configurado aún" });
      }
      const { idToken, orderId } = req.body;
      if (!idToken) return res.status(400).json({ message: "idToken requerido" });
      const googleData = await verifyGoogleToken(idToken);
      const customer = await findOrCreateCustomer(googleData);
      const tenantId = resolveTenantId(req);
      let pointsBalance = 0;
      let earnedPoints = 0;

      if (tenantId) {
        // Fetch loyalty account balance
        const [account] = await db.select({ pointsBalance: loyaltyAccounts.pointsBalance, lifetimePoints: loyaltyAccounts.lifetimePoints, id: loyaltyAccounts.id })
          .from(loyaltyAccounts)
          .where(and(eq(loyaltyAccounts.customerId, customer.id), eq(loyaltyAccounts.tenantId, tenantId)))
          .limit(1);

        // Award points for this order if orderId provided and not already awarded
        if (orderId) {
          const [config] = await db.select().from(loyaltyConfig).where(eq(loyaltyConfig.tenantId, tenantId));
          if (config?.isActive) {
            // Check if points already awarded for this order + customer
            const alreadyAwarded = await db.select({ id: loyaltyEvents.id })
              .from(loyaltyEvents)
              .where(and(
                eq(loyaltyEvents.customerId, customer.id),
                eq(loyaltyEvents.tenantId, tenantId),
                eq(loyaltyEvents.orderId, Number(orderId)),
                eq(loyaltyEvents.eventType, "EARN"),
              ))
              .limit(1);

            if (alreadyAwarded.length === 0) {
              // Get order total from tenant DB
              const tenantDb = req.db;
              if (!tenantDb) return res.status(400).json({ message: "Contexto de tenant requerido" });
              const [order] = await tenantDb.select({ totalAmount: orders.totalAmount })
                .from(orders)
                .where(eq(orders.id, Number(orderId)))
                .limit(1);

              if (order && parseFloat(order.totalAmount || "0") > 0) {
                const earnRate = parseFloat(config.earnRate) / 100;
                earnedPoints = Math.floor(parseFloat(order.totalAmount) * earnRate);
                if (earnedPoints > 0) {
                  if (!account) {
                    await db.insert(loyaltyAccounts).values({
                      customerId: customer.id, tenantId,
                      pointsBalance: String(earnedPoints),
                      lifetimePoints: String(earnedPoints),
                    });
                  } else {
                    const newBal = parseFloat(account.pointsBalance) + earnedPoints;
                    const newLifetime = parseFloat(account.lifetimePoints) + earnedPoints;
                    await db.update(loyaltyAccounts).set({
                      pointsBalance: String(newBal),
                      lifetimePoints: String(newLifetime),
                      updatedAt: new Date(),
                    }).where(eq(loyaltyAccounts.id, account.id));
                  }
                  await db.insert(loyaltyEvents).values({
                    customerId: customer.id, tenantId, eventType: "EARN",
                    points: String(earnedPoints), amountSpent: order.totalAmount,
                    orderId: Number(orderId),
                    description: `Puntos por compra — Orden #${orderId}`,
                  });
                }
              }
            }
          }
        }

        // Re-fetch balance after potential award
        const [freshAccount] = await db.select({ pointsBalance: loyaltyAccounts.pointsBalance })
          .from(loyaltyAccounts)
          .where(and(eq(loyaltyAccounts.customerId, customer.id), eq(loyaltyAccounts.tenantId, tenantId)))
          .limit(1);
        if (freshAccount) pointsBalance = parseFloat(freshAccount.pointsBalance) || 0;
      }

      res.json({
        customer,
        pointsBalance,
        earnedPoints,
        token: Buffer.from(JSON.stringify({ customerId: customer.id, email: customer.email })).toString("base64"),
      });
    } catch (err: any) {
      res.status(err.status || 401).json({ message: "Token de Google inválido: " + err.message });
    }
  });

  // POST /api/loyalty/session-award — award points for an order using a stored loyalty token
  app.post("/api/loyalty/session-award", async (req: any, res: any) => {
    try {
      const { loyaltyToken, orderId } = req.body;
      if (!loyaltyToken || !orderId) return res.status(400).json({ message: "loyaltyToken y orderId requeridos" });
      let customerId: number;
      try {
        const decoded = JSON.parse(Buffer.from(loyaltyToken, "base64").toString("utf8"));
        customerId = decoded.customerId;
        if (!customerId) throw new Error("invalid");
      } catch { return res.status(400).json({ message: "Token inválido" }); }

      const tenantId = resolveTenantId(req);
      if (!tenantId) return res.status(400).json({ message: "tenantId requerido" });

      const [config] = await db.select().from(loyaltyConfig).where(eq(loyaltyConfig.tenantId, tenantId));
      if (!config?.isActive) return res.json({ earnedPoints: 0, pointsBalance: 0 });

      // Check if already awarded
      const alreadyAwarded = await db.select({ id: loyaltyEvents.id })
        .from(loyaltyEvents)
        .where(and(
          eq(loyaltyEvents.customerId, customerId),
          eq(loyaltyEvents.tenantId, tenantId),
          eq(loyaltyEvents.orderId, Number(orderId)),
          eq(loyaltyEvents.eventType, "EARN"),
        )).limit(1);

      let earnedPoints = 0;
      if (alreadyAwarded.length === 0) {
        const tenantDb = req.db;
        if (!tenantDb) return res.status(400).json({ message: "Contexto de tenant requerido" });
        const [order] = await tenantDb.select({ totalAmount: orders.totalAmount })
          .from(orders).where(eq(orders.id, Number(orderId))).limit(1);
        if (order && parseFloat(order.totalAmount || "0") > 0) {
          const earnRate = parseFloat(config.earnRate) / 100;
          earnedPoints = Math.floor(parseFloat(order.totalAmount) * earnRate);
          if (earnedPoints > 0) {
            const [account] = await db.select({ pointsBalance: loyaltyAccounts.pointsBalance, lifetimePoints: loyaltyAccounts.lifetimePoints, id: loyaltyAccounts.id })
              .from(loyaltyAccounts)
              .where(and(eq(loyaltyAccounts.customerId, customerId), eq(loyaltyAccounts.tenantId, tenantId)))
              .limit(1);
            if (!account) {
              await db.insert(loyaltyAccounts).values({ customerId, tenantId, pointsBalance: String(earnedPoints), lifetimePoints: String(earnedPoints) });
            } else {
              await db.update(loyaltyAccounts).set({
                pointsBalance: String(parseFloat(account.pointsBalance) + earnedPoints),
                lifetimePoints: String(parseFloat(account.lifetimePoints) + earnedPoints),
                updatedAt: new Date(),
              }).where(eq(loyaltyAccounts.id, account.id));
            }
            await db.insert(loyaltyEvents).values({
              customerId, tenantId, eventType: "EARN",
              points: String(earnedPoints), amountSpent: order.totalAmount,
              orderId: Number(orderId), description: `Puntos por compra — Orden #${orderId}`,
            });
          }
        }
      }

      const [freshAccount] = await db.select({ pointsBalance: loyaltyAccounts.pointsBalance })
        .from(loyaltyAccounts)
        .where(and(eq(loyaltyAccounts.customerId, customerId), eq(loyaltyAccounts.tenantId, tenantId)))
        .limit(1);
      const pointsBalance = freshAccount ? parseFloat(freshAccount.pointsBalance) || 0 : 0;
      res.json({ earnedPoints, pointsBalance });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/loyalty/auth/email", async (req: any, res: any) => {
    try {
      const name = (req.body.name || "").trim();
      const email = (req.body.email || "").trim().toLowerCase();
      const phone = (req.body.phone || "").trim() || null;
      if (!name || !email) return res.status(400).json({ message: "Nombre y correo son requeridos" });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ message: "Correo electrónico inválido" });

      let [customer] = await db.select().from(customers)
        .where(eq(customers.email, email));

      if (customer) {
        [customer] = await db.update(customers).set({
          lastSeenAt: new Date(),
          name: customer.name || name,
          phone: phone || customer.phone,
        }).where(eq(customers.id, customer.id)).returning();
      } else {
        [customer] = await db.insert(customers).values({
          email,
          name,
          phone,
        }).returning();
      }

      res.json({
        customer,
        token: Buffer.from(JSON.stringify({ customerId: customer.id, email: customer.email })).toString("base64"),
      });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(409).json({ message: "Este correo ya está registrado. Intenta iniciar sesión." });
      }
      res.status(500).json({ message: "Error al registrar: " + err.message });
    }
  });

  // GET /api/loyalty/config
  app.get("/api/loyalty/config", async (req: any, res: any) => {
    try {
      const tenantId = getTenantId(req);
      const [config] = await db.select().from(loyaltyConfig)
        .where(eq(loyaltyConfig.tenantId, tenantId));
      res.json(config || null);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // PUT /api/loyalty/config
  app.put("/api/loyalty/config", async (req: any, res: any) => {
    try {
      const tenantId = getTenantId(req);
      const { isActive, earnRate, minRedeemPoints, redeemRate, pointsExpiryDays } = req.body;
      const existing = await db.select().from(loyaltyConfig)
        .where(eq(loyaltyConfig.tenantId, tenantId));
      let result;
      if (existing.length === 0) {
        [result] = await db.insert(loyaltyConfig).values({
          tenantId, isActive, earnRate, minRedeemPoints, redeemRate, pointsExpiryDays,
        }).returning();
      } else {
        [result] = await db.update(loyaltyConfig).set({
          isActive, earnRate, minRedeemPoints, redeemRate, pointsExpiryDays,
          updatedAt: new Date(),
        }).where(eq(loyaltyConfig.tenantId, tenantId)).returning();
      }
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // GET /api/loyalty/customers/search?q=email_o_nombre
  app.get("/api/loyalty/customers/search", async (req: any, res: any) => {
    try {
      const { q } = req.query;
      if (!q || String(q).length < 2) return res.json([]);
      const tenantId = getTenantId(req);
      const { rows } = await pool.query(
        `SELECT c.id, c.name, c.email, c.photo_url,
                la.points_balance, la.lifetime_points
         FROM public.customers c
         LEFT JOIN public.loyalty_accounts la
           ON la.customer_id = c.id AND la.tenant_id = $1
         WHERE c.email ILIKE $2 OR c.name ILIKE $2
         LIMIT 10`,
        [tenantId, `%${q}%`]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // GET /api/loyalty/customers
  app.get("/api/loyalty/customers", async (req: any, res: any) => {
    try {
      const tenantId = getTenantId(req);
      const { rows } = await pool.query(
        `SELECT c.id, c.name, c.email, c.photo_url, c.phone,
                la.points_balance, la.lifetime_points, la.updated_at AS last_activity
         FROM public.loyalty_accounts la
         JOIN public.customers c ON c.id = la.customer_id
         WHERE la.tenant_id = $1
         ORDER BY la.lifetime_points DESC
         LIMIT 200`,
        [tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // GET /api/loyalty/customers/:id/accounts — cuentas en todos los tenants
  app.get("/api/loyalty/customers/:id/accounts", async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      const { rows } = await pool.query(
        `SELECT la.*, t.business_name,
                MAX(le.created_at) as last_visit
         FROM public.loyalty_accounts la
         JOIN public.tenants t ON t.id = la.tenant_id
         LEFT JOIN public.loyalty_events le
           ON le.customer_id = la.customer_id AND le.tenant_id = la.tenant_id
         WHERE la.customer_id = $1
         GROUP BY la.id, t.business_name
         ORDER BY last_visit DESC NULLS LAST`,
        [customerId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/loyalty/customers/:id
  app.get("/api/loyalty/customers/:id", async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      const tenantId = resolveTenantId(req);
      const [customer] = await db.select().from(customers)
        .where(eq(customers.id, customerId));
      if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
      const account = tenantId
        ? (await db.select().from(loyaltyAccounts)
            .where(and(eq(loyaltyAccounts.customerId, customerId), eq(loyaltyAccounts.tenantId, tenantId))))[0] || null
        : null;
      const events = tenantId
        ? await db.select().from(loyaltyEvents)
            .where(and(eq(loyaltyEvents.customerId, customerId), eq(loyaltyEvents.tenantId, tenantId)))
            .orderBy(desc(loyaltyEvents.createdAt)).limit(20)
        : [];
      res.json({ customer, account, events });
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // POST /api/loyalty/earn
  app.post("/api/loyalty/earn", async (req: any, res: any) => {
    try {
      const { customerId, orderId, amountSpent } = req.body;
      const tenantId = getTenantId(req);
      if (!customerId || !amountSpent) {
        return res.status(400).json({ message: "customerId y amountSpent requeridos" });
      }
      const [config] = await db.select().from(loyaltyConfig)
        .where(eq(loyaltyConfig.tenantId, tenantId));
      if (!config || !config.isActive) {
        return res.json({ points: 0, message: "Loyalty no activo para este tenant" });
      }
      const earnRate = parseFloat(config.earnRate) / 100;
      const pointsEarned = Math.floor(parseFloat(amountSpent) * earnRate);
      if (pointsEarned <= 0) return res.json({ points: 0 });

      const existing = await db.select().from(loyaltyAccounts)
        .where(and(
          eq(loyaltyAccounts.customerId, customerId),
          eq(loyaltyAccounts.tenantId, tenantId)
        ));
      if (existing.length === 0) {
        await db.insert(loyaltyAccounts).values({
          customerId, tenantId,
          pointsBalance: String(pointsEarned),
          lifetimePoints: String(pointsEarned),
        });
      } else {
        await db.update(loyaltyAccounts).set({
          pointsBalance: String(parseFloat(existing[0].pointsBalance) + pointsEarned),
          lifetimePoints: String(parseFloat(existing[0].lifetimePoints) + pointsEarned),
          updatedAt: new Date(),
        }).where(eq(loyaltyAccounts.id, existing[0].id));
      }

      await db.insert(loyaltyEvents).values({
        customerId, tenantId,
        eventType: "EARN",
        points: String(pointsEarned),
        amountSpent: String(amountSpent),
        orderId,
        description: `Puntos acumulados por compra de ₡${parseInt(amountSpent).toLocaleString("es-CR")}`,
      });

      res.json({ points: pointsEarned, message: `+${pointsEarned} puntos RMS acumulados` });
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // POST /api/loyalty/redeem
  app.post("/api/loyalty/redeem", async (req: any, res: any) => {
    try {
      const { customerId, pointsToRedeem, orderId } = req.body;
      const tenantId = getTenantId(req);
      const [config] = await db.select().from(loyaltyConfig)
        .where(eq(loyaltyConfig.tenantId, tenantId));
      if (!config || !config.isActive) {
        return res.status(400).json({ message: "Loyalty no activo" });
      }
      const [account] = await db.select().from(loyaltyAccounts)
        .where(and(
          eq(loyaltyAccounts.customerId, customerId),
          eq(loyaltyAccounts.tenantId, tenantId)
        ));
      if (!account) return res.status(404).json({ message: "Cuenta de loyalty no encontrada" });
      if (parseFloat(account.pointsBalance) < parseFloat(config.minRedeemPoints)) {
        return res.status(400).json({ message: `Mínimo ${config.minRedeemPoints} puntos para redimir` });
      }
      if (parseFloat(account.pointsBalance) < pointsToRedeem) {
        return res.status(400).json({ message: "Puntos insuficientes" });
      }
      const discountAmount = pointsToRedeem * parseFloat(config.redeemRate);

      await db.update(loyaltyAccounts).set({
        pointsBalance: String(parseFloat(account.pointsBalance) - pointsToRedeem),
        updatedAt: new Date(),
      }).where(eq(loyaltyAccounts.id, account.id));

      await db.insert(loyaltyEvents).values({
        customerId, tenantId,
        eventType: "REDEEM",
        points: String(-pointsToRedeem),
        orderId,
        description: `Redención de ${pointsToRedeem} puntos = ₡${discountAmount.toLocaleString("es-CR")} descuento`,
      });

      res.json({ discountAmount, pointsRedeemed: pointsToRedeem });
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
