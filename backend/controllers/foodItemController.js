import db from "../db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=150&q=80";

// Helper: strip "₹" or commas and parse numeric price
const parsePrice = (rawPrice) => {
  if (rawPrice === undefined || rawPrice === null) return NaN;
  const cleaned = String(rawPrice).replace(/[₹,\s]/g, "");
  return parseFloat(cleaned);
};

// Helper: delete local uploaded file if replaced/deleted
const deleteLocalUpload = (imagePath) => {
  if (imagePath && imagePath.startsWith("/uploads/")) {
    const fullPath = path.join(process.cwd(), imagePath);
    if (fs.existsSync(fullPath)) {
      fs.unlink(fullPath, (err) => {
        if (err) console.error("Failed to remove old image:", err);
      });
    }
  }
};

const saveBase64Image = (image) => {
  const matches = String(image).match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!matches) return null;

  const rawExt = matches[1].toLowerCase().replace("jpeg", "jpg");
  const ext = rawExt === "svg+xml" ? "svg" : rawExt;
  const buffer = Buffer.from(matches[2], "base64");
  const filename = `food_${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`;
  const uploadDirs = [
    path.join(process.cwd(), "uploads"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../uploads"),
  ];

  for (const dir of new Set(uploadDirs)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);
  }

  return `/uploads/${filename}`;
};

// Helper: Ensure food_items table exists
let tableInitialized = false;
const ensureFoodItemsTable = async () => {
  if (tableInitialized) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS food_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        food_code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        image LONGTEXT,
        available TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    tableInitialized = true;
  } catch (err) {
    // Table may already exist or DB connection error
  }
};

// GET ALL FOOD ITEMS + DASHBOARD STATS
export const getAllFoodItems = async (req, res) => {
  try {
    await ensureFoodItemsTable();
    const { search = "", category = "All", status = "All" } = req.query;

    let query = "SELECT * FROM food_items WHERE 1=1";
    const params = [];

    if (search.trim()) {
      query += " AND (name LIKE ? OR food_code LIKE ? OR category LIKE ?)";
      const keyword = `%${search.trim()}%`;
      params.push(keyword, keyword, keyword);
    }

    if (category && category !== "All" && category !== "all") {
      query += " AND LOWER(category) = LOWER(?)";
      params.push(category.trim());
    }

    if (status === "Available") {
      query += " AND available = 1";
    } else if (status === "Unavailable") {
      query += " AND available = 0";
    }

    query += " ORDER BY id DESC";

    const [items] = await db.query(query, params);

    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS totalItems,
        COALESCE(SUM(available = 1), 0) AS availableItems,
        COALESCE(SUM(available = 0), 0) AS unavailableItems,
        COUNT(DISTINCT category) AS totalCategories
      FROM food_items
    `);

    const [categoryCounts] = await db.query(`
      SELECT category, COUNT(*) AS count
      FROM food_items
      GROUP BY category
      ORDER BY count DESC
    `);

    return res.status(200).json({
      success: true,
      stats: {
        totalItems: Number(stats.totalItems),
        availableItems: Number(stats.availableItems),
        unavailableItems: Number(stats.unavailableItems),
        totalCategories: Number(stats.totalCategories),
      },
      categoryCounts,
      items: items.map((item) => ({
        ...item,
        available: Boolean(item.available),
      })),
    });
  } catch (error) {
    console.error("Get Food Items Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch food items",
    });
  }
};

// GET SINGLE FOOD ITEM BY ID
export const getFoodItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM food_items WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food item not found",
      });
    }

    return res.status(200).json({
      success: true,
      item: {
        ...rows[0],
        available: Boolean(rows[0].available),
      },
    });
  } catch (error) {
    console.error("Get Single Food Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// CREATE NEW FOOD ITEM
export const createFoodItem = async (req, res) => {
  try {
    await ensureFoodItemsTable();
    let { food_code, name, category, price, image, available } = req.body;
    if (!food_code && req.body.code) {
      food_code = req.body.code;
    }

    if (!name || !category || price === undefined || price === "") {
      if (req.file) deleteLocalUpload(`/uploads/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: "Food name, category, and price are required",
      });
    }

    const numericPrice = parsePrice(price);
    if (isNaN(numericPrice) || numericPrice < 0) {
      if (req.file) deleteLocalUpload(`/uploads/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: "Please provide a valid price",
      });
    }

    if (!food_code || !food_code.trim()) {
      const [[lastRow]] = await db.query(
        "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM food_items"
      );
      food_code = `FD-${String(lastRow.nextId).padStart(3, "0")}`;
    } else {
      food_code = food_code.trim().toUpperCase();
    }

    let finalImage = DEFAULT_IMAGE;
    if (req.file) {
      finalImage = `/uploads/${req.file.filename}`;
    } else if (image && String(image).startsWith("data:image/")) {
      finalImage = saveBase64Image(image) || DEFAULT_IMAGE;
    } else if (image && String(image).trim()) {
      finalImage = String(image).trim();
    }

    const isAvailable =
      available === false || available === "false" || available === 0 || available === "0"
        ? 0
        : 1;

    const [existing] = await db.query(
      "SELECT id FROM food_items WHERE food_code = ? LIMIT 1",
      [food_code]
    );
    if (existing.length > 0) {
      // If item with this food_code already exists, update it seamlessly
      await db.query(
        `UPDATE food_items
         SET name = ?, category = ?, price = ?, image = ?, available = ?
         WHERE food_code = ?`,
        [name.trim(), category.trim(), numericPrice, finalImage, isAvailable, food_code]
      );
      const [updated] = await db.query("SELECT * FROM food_items WHERE food_code = ?", [food_code]);
      return res.status(200).json({
        success: true,
        message: `Updated food item #${food_code} (${name.trim()})`,
        item: {
          ...updated[0],
          available: Boolean(updated[0].available),
        },
      });
    }

    const [result] = await db.query(
      `INSERT INTO food_items (food_code, name, category, price, image, available)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [food_code, name.trim(), category.trim(), numericPrice, finalImage, isAvailable]
    );

    const [created] = await db.query("SELECT * FROM food_items WHERE id = ?", [
      result.insertId,
    ]);

    return res.status(201).json({
      success: true,
      message: `Added new food item #${food_code} (${name.trim()})`,
      item: {
        ...created[0],
        available: Boolean(created[0].available),
      },
    });
  } catch (error) {
    console.error("Create Food Item Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create food item",
    });
  }
};

// UPDATE FOOD ITEM BY ID
export const updateFoodItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { food_code, name, category, price, image, available } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM food_items WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      if (req.file) deleteLocalUpload(`/uploads/${req.file.filename}`);
      return res.status(404).json({
        success: false,
        message: "Food item not found",
      });
    }

    const currentItem = rows[0];
    const updatedCode = food_code
      ? food_code.trim().toUpperCase()
      : currentItem.food_code;

    // Ensure new food_code doesn't collide with another item
    if (updatedCode !== currentItem.food_code) {
      const [dup] = await db.query(
        "SELECT id FROM food_items WHERE food_code = ? AND id != ? LIMIT 1",
        [updatedCode, id]
      );
      if (dup.length > 0) {
        if (req.file) deleteLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(409).json({
          success: false,
          message: `Food code ${updatedCode} is already in use`,
        });
      }
    }

    const updatedName = name ? name.trim() : currentItem.name;
    const updatedCategory = category ? category.trim() : currentItem.category;

    let updatedPrice = currentItem.price;
    if (price !== undefined && price !== "") {
      const parsed = parsePrice(price);
      if (isNaN(parsed) || parsed < 0) {
        if (req.file) deleteLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({
          success: false,
          message: "Please provide a valid price",
        });
      }
      updatedPrice = parsed;
    }

    let updatedImage = currentItem.image;
    if (req.file) {
      updatedImage = `/uploads/${req.file.filename}`;
    } else if (image !== undefined) {
      const trimmedImage = image.trim() || DEFAULT_IMAGE;
      if (trimmedImage.startsWith("data:image/")) {
        updatedImage = saveBase64Image(trimmedImage);
        if (!updatedImage) {
          return res.status(400).json({
            success: false,
            message: "Invalid image data",
          });
        }
      } else {
        updatedImage = trimmedImage;
      }
    }

    let updatedAvailable = currentItem.available;
    if (available !== undefined) {
      updatedAvailable =
        available === false || available === "false" || available === 0 || available === "0"
          ? 0
          : 1;
    }

    await db.query(
      `UPDATE food_items
       SET food_code = ?, name = ?, category = ?, price = ?, image = ?, available = ?
       WHERE id = ?`,
      [
        updatedCode,
        updatedName,
        updatedCategory,
        updatedPrice,
        updatedImage,
        updatedAvailable,
        id,
      ]
    );

    if (updatedImage !== currentItem.image) {
      deleteLocalUpload(currentItem.image);
    }

    const [updatedRows] = await db.query("SELECT * FROM food_items WHERE id = ?", [
      id,
    ]);

    return res.status(200).json({
      success: true,
      message: `Updated item ${updatedCode} (${updatedName})`,
      item: {
        ...updatedRows[0],
        available: Boolean(updatedRows[0].available),
      },
    });
  } catch (error) {
    console.error("Update Food Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update food item",
    });
  }
};

// TOGGLE AVAILABILITY BY ID
export const toggleFoodAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { available } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM food_items WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food item not found",
      });
    }

    const item = rows[0];
    const nextStatus =
      available !== undefined
        ? available === true || available === "true" || available === 1
          ? 1
          : 0
        : item.available
        ? 0
        : 1;

    await db.query("UPDATE food_items SET available = ? WHERE id = ?", [
      nextStatus,
      id,
    ]);

    return res.status(200).json({
      success: true,
      message: `${item.name} marked as ${nextStatus ? "Available" : "Unavailable"}`,
      item: {
        ...item,
        available: Boolean(nextStatus),
      },
    });
  } catch (error) {
    console.error("Toggle Availability Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update availability",
    });
  }
};

// DELETE FOOD ITEM BY ID
export const deleteFoodItem = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT * FROM food_items WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food item not found",
      });
    }

    const item = rows[0];
    deleteLocalUpload(item.image);

    await db.query("DELETE FROM food_items WHERE id = ?", [id]);

    return res.status(200).json({
      success: true,
      message: `${item.name} (${item.food_code}) has been removed`,
    });
  } catch (error) {
    console.error("Delete Food Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete food item",
    });
  }
};