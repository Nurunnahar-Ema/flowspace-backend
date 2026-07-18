import { Context } from "hono";
import { verify } from "hono/jwt";

export const viewFile = async (c: Context) => {
  const fileId = c.req.query("id");
  const cdnToken = c.req.query("t");
  const rangeHeader = c.req.header("Range");

  if (!cdnToken) {
    return c.text("Unauthorized: Missing secure token", 401);
  }

  try {
    const payload = await verify(cdnToken, c.env.JWT_SECRET, "HS256") as any;
    const { fileKey, s3Params } = payload;

    const r2BaseUrl = `${c.env.STORAGE_ENDPOINT}/${c.env.STORAGE_BUCKET}/${fileKey}`;
    const reconstructedUrl = new URL(r2BaseUrl);
    Object.entries(s3Params).forEach(([k, v]) => reconstructedUrl.searchParams.set(k, v as string));

    // আপনার ফ্রন্টএন্ডের মূল ডোমেইন (যেখানে iframe-টি থাকবে)
    // উদাহরণ: https://yourdomain.com অথবা লোকালহোস্টের জন্য http://localhost:5173
    const allowedOrigin = "http://localhost:5173"; 

    // ========================================================
    // ১. সিকিউরিটি হেডার্স (iframe প্রোটেকশন এবং ব্রাউজার ক্যাশ বন্ধ করা)
    // ========================================================
    const securityHeaders = new Headers();
    
    // ব্রাউজারকে নির্দেশ দেওয়া যেন সে নিজের মেমোরি বা ডিস্কে ফাইলটি ক্যাশ না করে
    securityHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    securityHeaders.set("Pragma", "no-cache");
    securityHeaders.set("Expires", "0");

    // Cloudflare CDN-কে নির্দেশ দেওয়া এটি ক্যাশ করার জন্য (যেমন: ১ বছর বা আপনার ইচ্ছেমতো)
    // s-maxage শুধু CDN/Proxy-র জন্য প্রযোজ্য, ব্রাউজার এটাকে ইগনোর করবে
    securityHeaders.set("Cloudflare-CDN-Cache-Control", "public, s-maxage=31536000");

    // iframe প্রোটেকশন: শুধুমাত্র নির্দিষ্ট ডোমেইনের iframe-এর ভেতরেই এটি লোড হবে
    securityHeaders.set("Content-Security-Policy", `frame-ancestors 'self' ${allowedOrigin};`);
    
    // পুরোনো ব্রাউজারগুলোর নিরাপত্তার জন্য X-Frame-Options (ALLOW-FROM বা SAMEORIGIN)
    securityHeaders.set("X-Frame-Options", "SAMEORIGIN");

    // ========================================================
    // ২. ব্রাউজার যদি Range হেডার না পাঠায় (প্রথমবার PDF লোড হলে)
    // ========================================================
    if (!rangeHeader) {
      const r2Response = await fetch(reconstructedUrl.toString(), { method: "GET" });
      if (!r2Response.ok) return c.text("Storage fetch failed or link expired", 403);

      const contentType = r2Response.headers.get("Content-Type") || "application/pdf";
      
      // সিকিউরিটি হেডারগুলো যুক্ত করা
      securityHeaders.set("Content-Type", contentType);
      securityHeaders.set("Content-Disposition", "inline");
      securityHeaders.set("Content-Length", r2Response.headers.get("Content-Length") || "");

      return new Response(r2Response.body, {
        status: 200,
        headers: securityHeaders,
      });
    }

    // ========================================================
    // ৩. ব্রাউজার যদি Range হেডার পাঠায় (Large File Range Request)
    // ========================================================
    const r2Response = await fetch(reconstructedUrl.toString(), {
      method: "GET",
      headers: { "Range": rangeHeader }
    });

    if (!r2Response.ok && r2Response.status !== 206) {
      return c.text("Storage fetch failed or link expired", 403);
    }

    // রেঞ্জ রিকোয়েস্টের জন্যও সিকিউরিটি হেডার সেট করা
    securityHeaders.set("Content-Type", r2Response.headers.get("Content-Type") || "application/octet-stream");
    securityHeaders.set("Content-Range", r2Response.headers.get("Content-Range") || "");
    securityHeaders.set("Accept-Ranges", "bytes");
    securityHeaders.set("Content-Length", r2Response.headers.get("Content-Length") || "");
    securityHeaders.set("Content-Disposition", "inline");

    return new Response(r2Response.body, {
      status: r2Response.status,
      headers: securityHeaders,
    });

  } catch (err) {
    return c.text("Link expired or invalid signature token", 403);
  }
};