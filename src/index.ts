import { Hono } from "hono";
import { cors } from "hono/cors";
import { AwsClient } from "aws4fetch";

interface Env {
  STORAGE_ENDPOINT: string;        // Supabase বা R2 endpoint
  STORAGE_ACCESS_KEY: string;      // Access Key
  STORAGE_SECRET_KEY: string;      // Secret Key
  STORAGE_BUCKET: string;          // Bucket name
}

const app = new Hono<{ Bindings: Env }>();

// সিকিউরিটির জন্য ফ্রন্টএন্ড পোর্ট নির্দিষ্ট করে দিতে পারেন
app.use("/*", cors({
  origin: "http://localhost:5173",
  allowMethods: ["POST", "GET", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["ETag"], // ফ্রন্টএন্ডের ETag রিড করার জন্য এটি আবশ্যক
}));

const getAwsClient = (env: Env) =>
  new AwsClient({
    accessKeyId: env.STORAGE_ACCESS_KEY,
    secretAccessKey: env.STORAGE_SECRET_KEY,
    region: "auto",
    service: "s3",
  });

// ১. Multipart Upload শুরু
app.post("/api/upload/start", async (c) => {
  try {
    const { filename, type } = await c.req.json();
    let decodedFilename = decodeURIComponent(filename);
    const cleanFilename = decodedFilename
      .replace(/\s+/g, '-')           
      .replace(/[^a-zA-Z0-9.-]/g, ''); 
    const userId = "usr_99";
    const fileKey = `users/${userId}/${Date.now()}_${cleanFilename}`;

    const aws = getAwsClient(c.env);
    const url = `${c.env.STORAGE_ENDPOINT}/${c.env.STORAGE_BUCKET}/${fileKey}?uploads`;

    const response = await aws.fetch(url, {
      method: "POST",
      headers: { "Content-Type": type },
    });

    const xmlText = await response.text();
    const uploadIdMatch = xmlText.match(/<UploadId>([^<]+)<\/UploadId>/);

    if (!uploadIdMatch) {
      return c.json({ error: "UploadId পাওয়া যায়নি", raw: xmlText }, 500);
    }

    return c.json({ uploadId: uploadIdMatch[1], key: fileKey });
  } catch (err: any) {
    return c.json({ error: "Upload start error", details: err.message }, 500);
  }
});

app.post("/api/upload/get-part-url", async (c) => {
  const { key, uploadId, partNumber } = await c.req.json();

  const aws = getAwsClient(c.env);
  const partUrl = `${c.env.STORAGE_ENDPOINT}/${c.env.STORAGE_BUCKET}/${key}?uploadId=${uploadId}&partNumber=${partNumber}`;

  // Signed request তৈরি করো
  const signedRequest = await aws.sign(partUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream"
    }
  });

  return c.json({
    url: signedRequest.url,
    headers: signedRequest.headers   // ফ্রন্টএন্ডে পাঠাও
  });
});



// ৩. Multipart Upload Complete (Updated 🛠️)
app.post("/api/upload/complete", async (c) => {
  try {
    const { key, uploadId, parts } = await c.req.json();

    const aws = getAwsClient(c.env);
    const url = `${c.env.STORAGE_ENDPOINT}/${c.env.STORAGE_BUCKET}/${key}?uploadId=${uploadId}`;

    // শুরুতে স্ট্যান্ডার্ড XML ডিক্লেয়ারেশন যুক্ত করা হলো
    let xmlBody = '<?xml version="1.0" encoding="UTF-8"?>';
    xmlBody += "<CompleteMultipartUpload>";
    
    parts.forEach((part: { ETag: string; PartNumber: number }) => {
      // ETag থেকে সব ধরণের কোটেশন ক্লিন করে খাঁটি S3 স্ট্যান্ডার্ডে ডাবল কোট দেওয়া
      const cleanETag = part.ETag.replace(/"/g, '');
      xmlBody += `<Part><PartNumber>${part.PartNumber}</PartNumber><ETag>"${cleanETag}"</ETag></Part>`;
    });
    xmlBody += "</CompleteMultipartUpload>";

    const response = await aws.fetch(url, {
      method: "POST",
      // হেডারটি নির্দিষ্ট করে দেওয়া হলো যেন গেটওয়ে বুঝতে পারে এটি XML ডেটা
      headers: { 
        "Content-Type": "application/xml"
      },
      body: xmlBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: "Upload complete failed", details: errorText }, 500);
    }

    return c.json({ success: true, message: "ফাইল সফলভাবে আপলোড ও জোড়া লাগানো হয়েছে!" });
  } catch (err: any) {
    return c.json({ error: "Upload complete error", details: err.message }, 500);
  }
});
export default app;