import { Context } from "hono";
import { sign, verify } from "hono/jwt";
import { sql, eq } from "drizzle-orm";
import { users, requestLog, storage } from "../Models/schema";
import { getDb } from "../Models";
import { getAwsClient } from "../index";

// সেশন ভেরিফিকেশনের জন্য হেল্পার ফাংশন
const verifyUserSession = async (c: Context): Promise<{ isValid: boolean; payload?: any; errorMsg?: string }> => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return { isValid: false, errorMsg: 'Authorization header missing' };

  const token = authHeader.split(' ')[1];
  if (!token) return { isValid: false, errorMsg: 'Token missing' };

  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256") as any;
    const session = String(payload.session);

    const KV = c.env.FLOWSPACE_USER_AUTH;
    if (!KV) return { isValid: false, errorMsg: 'Server configuration error: KV missing' };

    const storedToken = await KV.get(session);
    if (!storedToken || storedToken !== token) {
      return { isValid: false, errorMsg: 'Session expired or logged in elsewhere' };
    }

    return { isValid: true, payload };
  } catch (e) {
    return { isValid: false, errorMsg: 'Invalid or Expired token' };
  }
};

export const getFileUrl = async (c: Context) => {
  try {
    const { userId } = await c.req.json();
    const fileId = c.req.param("id");
    if (!fileId || !userId) {
      return c.json({ success: false, message: "File ID and User ID are required" }, 400);
    }

    const db = getDb(c.env["saas-hyper"].connectionString);

    // ১. ডাটাবেজ থেকে ফাইলটি চেক করা
    const [file] = await db.select().from(storage).where(eq(storage.id, fileId)).limit(1);
    if (!file) {
      return c.json({ success: false, message: "File not found" }, 404);
    }

    const domain = c.req.header('Origin') || "";

    // ২. ফাইলটি যদি প্রাইভেট হয়, তবে সেশন, ডোমেইন এবং ইউজার পারমিশন ভেরিফাই করা 🔒
    if (!file.isPublic) {
      const sessionCheck = await verifyUserSession(c);
      if (!sessionCheck.isValid) {
        return c.json({ success: false, message: sessionCheck.errorMsg }, 401);
      }

      // ডাটাবেজের JSONB 'permissions' কলামটি পার্স করে রিড করা (ফেইলসেফসহ)
      const permissions = (file.permissions as { domain?: string[]; userId?: string[] }) || {};
      const allowedDomains = permissions.domain || [];
      const allowedUsers = permissions.userId || [];

      // ডোমেইন পারমিশন চেক
      if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
        return c.json({ success: false, message: "Forbidden: Domain not allowed" }, 403);
      }

      // ইউজার অ্যাক্সেস লিস্ট চেক (অনার ব্যতীত অন্য কোনো ইউজারের ক্ষেত্রে)
      if (userId !== file.userId) {
        if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
          return c.json({ success: false, message: "Forbidden: User not allowed" }, 403);
        }
      }
    }

    // ৩. ইউজারের লিমিট চেক ও রিকোয়েস্ট কমানোর ট্রানজেকশন (Transaction) 🛠️
    const transactionResult = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        return { error: "User not found", status: 404 };
      }

      if (Number(user.request) <= 0) {
        return { error: "Request limit exceeded", status: 403 };
      }

      // ক) ইউজারের রিকোয়েস্ট কাউন্ট ১ কমানো
      await tx.update(users)
        .set({ request: sql`${users.request} - 1` })
        .where(eq(users.id, userId));

      // খ) লগ টেবিলে ডেটা ইনসার্ট করা
      await tx.insert(requestLog).values({
        userId: userId,
        fileId: fileId,
        ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null,
        userAgent: c.req.header('User-Agent') || null,
        others: { domain, timestamp: new Date().toISOString() },
        createdAt: new Date(),
      });

      return { success: true };
    });

    if (transactionResult.error) {
      return c.json({ success: false, message: transactionResult.error }, transactionResult.status);
    }

    // ৪. R2 প্রিজাইনড সাইনড ইউআরএল তৈরি করা
    const aws = getAwsClient(c.env);
    const fileUrl = `${c.env.STORAGE_ENDPOINT}/${c.env.STORAGE_BUCKET}/${file.filepath}`;
    
    const signed = await aws.sign(fileUrl, {
      method: "GET",
      aws: { signQuery: true, expiresIn: 3600 } // ১ ঘণ্টা মেয়াদ
    });

    // ৫. [new URL() ছাড়া] পিওর স্ট্রিং স্প্লিট মেথডে কুয়েরি প্যারামিটারগুলো আলাদা করা 🧩
    const queryParams: Record<string, string> = {};
    const urlParts = signed.url.split("?");
    if (urlParts.length > 1) {
      const queryString = urlParts[1];
      const pairs = queryString.split("&");
      for (const pair of pairs) {
        const [k, v] = pair.split("=");
        if (k) {
          queryParams[decodeURIComponent(k)] = decodeURIComponent(v || "");
        }
      }
    }

    // ৬. সুরক্ষিত JWT মাস্কড টোকেন তৈরি
    const tokenPayload = {
      fileKey: file.filepath,
      s3Params: queryParams,
      exp: Math.floor(Date.now() / 1000) + 3600, // ১ ঘণ্টা মেয়াদ
    };
    const cdnToken = await sign(tokenPayload, c.env.JWT_SECRET);

    // ৭. মাস্কড ইউআরএল তৈরি (যা প্লেয়ারের Src তে বসবে)
    const maskedCdnUrl = `/api/storage/view?id=${fileId}&t=${cdnToken}`;

    return c.json({ 
      success: true, 
      urlkey: maskedCdnUrl 
    });

  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
};