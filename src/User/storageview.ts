import { Hono } from "hono";
import { Context } from "hono";
import { getDb } from "../Models";
import { storage } from "../Models/schema";
import { like, eq } from "drizzle-orm";


// হেল্পার ফাংশন
function isFolder(path: string): boolean {
  return path.endsWith("/");
}

function isFile(path: string): boolean {
  const availableExtensions = [".txt", ".pdf", ".jpg", ".png", ".docx", ".xlsx", ".mp4", ".mp3"];
  return availableExtensions.some(ext => path.toLowerCase().endsWith(ext));
}

export const getStorageItems = async (c: Context) => {
  try {
    let path = c.req.query("p") || "";
    const db = getDb(c.env["saas-hyper"].connectionString);

    // 📂 ফোল্ডার রেন্ডারিং
    if (path === "" || isFolder(path)) {
      const allNestedItems = await db
        .select()
        .from(storage)
        .where(like(storage.filepath, `${path}%`))
        .execute();

      const itemsMap = new Map();

      for (const item of allNestedItems) {
        const relativePath = item.filepath.slice(path.length);
        const parts = relativePath.split("/");

        // শুধু immediate child ফাইল/ফোল্ডার
        if (parts.length === 1 || (parts.length === 2 && parts[1] === "")) {
          if (!itemsMap.has(item.filename)) {   // ✅ একই নামে একাধিক ফোল্ডার বাদ যাবে
            itemsMap.set(item.filename, {
              id: item.id,
              name: item.filename,
              filepath: item.filepath,
              mimetype: item.mimetype,
              size: item.size?.toString(),
              isPublic: item.isPublic,
              type: item.mimetype === "directory" ? "folder" : "file",
              updatedAt: item.updatedAt
            });
          }
        }
      }

      return c.json({
        success: true,
        type: "folder",
        currentPath: path || "/",
        items: Array.from(itemsMap.values())
      });
    }

    // 📄 ফাইল রেন্ডারিং
    const [file] = await db
      .select()
      .from(storage)
      .where(eq(storage.filepath, path))
      .execute();

    if (!file) {
      return c.json({ success: false, message: "File or Folder not found" }, 404);
    }

    return c.json({
      success: true,
      type: "file",
      item: {
        ...file,
        size: file.size ? file.size.toString() : "0"
      }
    });

  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
};

