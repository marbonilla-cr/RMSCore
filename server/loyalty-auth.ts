import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { customers } from "@shared/schema";
import { eq } from "drizzle-orm";

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return client;
}

export async function verifyGoogleToken(idToken: string) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId || googleClientId === "pending") {
    throw new Error("Google OAuth no configurado aún");
  }
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("Token inválido");
  return {
    googleId: payload.sub,
    email: payload.email!,
    name: payload.name!,
    photoUrl: payload.picture,
  };
}

export async function findOrCreateCustomer(googleData: {
  googleId: string;
  email: string;
  name: string;
  photoUrl?: string;
}) {
  let [customer] = await db.select().from(customers)
    .where(eq(customers.googleId, googleData.googleId));

  if (!customer) {
    [customer] = await db.select().from(customers)
      .where(eq(customers.email, googleData.email));
  }

  if (customer) {
    [customer] = await db.update(customers).set({
      lastSeenAt: new Date(),
      googleId: googleData.googleId,
      photoUrl: googleData.photoUrl,
    }).where(eq(customers.id, customer.id)).returning();
  } else {
    [customer] = await db.insert(customers).values({
      googleId: googleData.googleId,
      email: googleData.email,
      name: googleData.name,
      photoUrl: googleData.photoUrl,
    }).returning();
  }

  return customer;
}
