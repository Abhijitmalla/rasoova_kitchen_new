import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import adminRoutes from "./routes/adminRoutes.js";
import foodItemRoutes from "./routes/foodItemRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import foodOrderRoutes from "./routes/foodOrderRoutes.js";
import riderRoutes from "./routes/riderLoginRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env reliably whether started from backend/ or project root
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

// Ensure JWT_SECRET is present
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "rasoova_admin_jwt_secret_key_2026";
}

const app = express();

// Middleware: Permissive CORS for all local development ports (5500, 5501, 3000, 5173, etc.)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"]
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static uploads directory (support both backend/uploads and project root uploads/)
const backendUploads = path.join(__dirname, "uploads");
const rootUploads = path.join(process.cwd(), "uploads");
if (!fs.existsSync(backendUploads)) fs.mkdirSync(backendUploads, { recursive: true });
if (!fs.existsSync(rootUploads)) fs.mkdirSync(rootUploads, { recursive: true });

app.use("/uploads", express.static(backendUploads));
app.use("/uploads", express.static(rootUploads));

// Admin Routes
app.use("/api/admin", adminRoutes);

// Food Item Routes
app.use("/api/food-items", foodItemRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/food-orders", foodOrderRoutes);
app.use("/api/riders", riderRoutes);
app.use("/api/rider", riderRoutes);
// Default Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Rasooova Admin & Food API is running",
    endpoints: {
      admin: "/api/admin",
      foodItems: "/api/food-items",
      uploads: "/uploads"
    }
  });
});

// Start Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
