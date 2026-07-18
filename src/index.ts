import { Hono } from "hono";
import { cors } from "hono/cors";
import { AwsClient } from "aws4fetch";
import { userlogin } from "./User/auth";
import { getDb } from "./Models";
import { getStorageItems } from "./User/storageview";
import { adminSession } from "./User/auth";
import { getFileUrl } from "./component/getfileurl";
import { viewFile } from "./component/viewfile";

interface Env {
  STORAGE_ENDPOINT: string;        // Supabase বা R2 endpoint
  STORAGE_ACCESS_KEY: string;      // Access Key
  STORAGE_SECRET_KEY: string;      // Secret Key
  STORAGE_BUCKET: string;          // Bucket name
  "saas-hyper": { connectionString: string }; // Database connection string
}

const app = new Hono<{ Bindings: Env }>();

// সিকিউরিটির জন্য ফ্রন্টএন্ড পোর্ট নির্দিষ্ট করে দিতে পারেন
app.use("/*", cors({
  origin: "*",
  allowMethods: ["POST", "GET", "OPTIONS", "PUT"],
  allowHeaders: ["Content-Type", "Authorization", "x-amz-date", "x-amz-content-sha256"],
  exposeHeaders: ["ETag"],
}));

export const getAwsClient = (env: Env) =>
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
  const { key, uploadId, partNumber, contentLength } = await c.req.json();

  const aws = getAwsClient(c.env);
  const partUrl = `${c.env.STORAGE_ENDPOINT}/${c.env.STORAGE_BUCKET}/${key}?uploadId=${uploadId}&partNumber=${partNumber}`;

  // এই 3 টা header sign করা বাধ্যতামূলক
  const headersToSign = {
    "content-length": contentLength.toString(),
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD", // body hash skip করলাম
    "host": new URL(partUrl).host // host ও sign করতে হবে
  };

  const signedRequest = await aws.sign(partUrl, {
    method: "PUT",
    headers: headersToSign
  });

  // signedRequest.headers থেকে দরকারি গুলো বের করো
  return c.json({
    url: partUrl, // unsigned URL পাঠাবো
    headers: {
      "Authorization": signedRequest.headers.get("authorization"),
      "x-amz-date": signedRequest.headers.get("x-amz-date"),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "Content-Length": contentLength.toString()
    }
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



app.post("/api/upload/get-download-url",)
app.get("/api/storage",getStorageItems)
app.post("/api/storage/get/:id", getFileUrl);
app.get("/api/storage/view", viewFile);



app.post("/api/auth/user/login", userlogin);

export default app;