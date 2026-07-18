import { Context, Hono, Next } from "hono";
import { sign, verify } from "hono/jwt";
import { setCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import { getDb } from "../Models/index";
import { users } from "../Models/schema";
import { nanoid } from 'nanoid';

// গ্লোবাল বাইন্ডিংস টাইপ
type Bindings = {
  "saas-hyper": any;
  FLOWSPACE_USER_AUTH: any; // KV Namespace binding
  JWT_SECRET: string;
}

// ==================== ১. লগইন কন্ট্রোলার ====================
export const userlogin = async (c: Context<{ Bindings: Bindings }>) => {
  try {
    const body = await c.req.json();
    const { mobile, password } = body;

    if (!mobile || !password) {
      return c.json({ success: false, message: "মোবাইল এবং পাসওয়ার্ড আবশ্যক!" }, 400);
    }

    const db = getDb(c.env["saas-hyper"].connectionString);

    // ✅ Drizzle AND কন্ডিশন ফিক্সড (সব কুয়েরি কমা দিয়ে and-এর ব্র্যাকেটের ভেতরে থাকবে)
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.mobile, mobile), 
          eq(users.password, password)
        )
      )
      .limit(1);

    if (!user) {
      return c.json({ success: false, message: "মোবাইল নম্বর বা পাসওয়ার্ড ভুল!" }, 401);
    }

    const newSessionUuid = nanoid(21);
    const mobileStr = String(user.mobile); // ✅ KV এর জন্য স্ট্রিং নিশ্চিত করা হলো

    const payload = {
      mobile: mobileStr,
      name: user.name,
      email: user.email,
      role: "user",
      logo: user.avatarUrl,
      session: newSessionUuid,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // ২৪ ঘণ্টা মেয়াদ
    };
 
     
    const token = await sign(payload, c.env.JWT_SECRET);
    
    // ✅ KV-তে স্ট্রিং কি (Key) ব্যবহার করা হলো
    await c.env.FLOWSPACE_USER_AUTH.put(newSessionUuid, token, { expirationTtl: 86400 });

    // ৫. কুকিতে টোকেন সেট করা
    setCookie(c, "flowspace_user_auth", token, {
      httpOnly: true, // 🔒 সিকিউরিটির জন্য এটিকে true করা উচিত যেন JS দিয়ে কুকি চুরি না হয়
      secure: true,   // 🔒 প্রোডাকশনে HTTPS এর জন্য true
      sameSite: "Lax",
      maxAge: 86400,
    });

    return c.json({
      success: true,
      message: "লগইন সফল হয়েছে",
      token: token,
      user: { name: user.name, mobile: user.mobile, session: newSessionUuid },
    });
  } catch (error) {
    console.error("Login Error:", error);
    return c.json({ success: false, message: "সার্ভারে সমস্যা হয়েছে!" }, 500);
  }
};




// ==================== ২. সেশন মিডলওয়্যার (Auth Guard) ====================
// ✅ { Bindings: Bindings } যুক্ত করা হলো যেন টাইপস্ক্রিপ্ট c.env.JWT_SECRET চিনতে পারে
// সেশন মিডলওয়্যার (Auth Guard)
export const adminSession = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader) return c.json({ error: 'Authorization header missing' }, 401);

  const token = authHeader.split(' ')[1];
  if (!token) return c.json({ error: 'Token missing' }, 401);

  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256") as any;
    const session = String(payload.session); // ✅ KV এর জন্য স্ট্রিং নিশ্চিত করা হলো

    // 💡 আপনার wrangler.toml এ যে নাম আছে সেটাই এখানে হুবহু বসবে
    const KV = c.env.FLOWSPACE_USER_AUTH; 
    
    if (!KV) {
        return c.json({ error: 'Server configuration error' }, 500);
    }

    const storedToken = await KV.get(session);

    if (!storedToken || storedToken !== token) {
      return c.json({ 
        error: 'Session expired or logged in elsewhere',
        status: 'logout',
        role: 'admin'
      }, 401);
    }

    c.set('jwtPayload', payload);
    await next();
    
  } catch (e) {
    return c.json({ error: 'Invalid or Expired token' }, 401);
  }
}