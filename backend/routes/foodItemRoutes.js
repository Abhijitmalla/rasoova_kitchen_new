import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { verifyAdminToken } from "../middleware/authMiddleware.js";
import {
  getAllFoodItems,
  getFoodItemById,
  createFoodItem,
  updateFoodItem,
  toggleFoodAvailability,
  deleteFoodItem,
} from "../controllers/foodItemController.js";

const router = express.Router();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `food_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (PNG, JPG, WEBP) are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Middleware: cleanly bypass multer for application/json payloads
const handleUpload = (req, res, next) => {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return next();
  }
  upload.single("imageFile")(req, res, (err) => {
    if (err) {
      console.warn("Multer upload warning:", err.message);
    }
    next();
  });
};

// Public GET routes
router.get("/", getAllFoodItems);
router.get("/:id", getFoodItemById);

// Admin Write Routes
router.post("/", verifyAdminToken, handleUpload, createFoodItem);
router.put("/:id", verifyAdminToken, handleUpload, updateFoodItem);
router.patch("/:id/availability", verifyAdminToken, toggleFoodAvailability);
router.delete("/:id", verifyAdminToken, deleteFoodItem);

export default router;