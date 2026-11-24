
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import adminRoutes from "./routes/adminRoutes.js";

dotenv.config();

const app = express();

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://127.0.0.1:5501",
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Admin Routes
app.use("/api/admin", adminRoutes);

// Default Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Rasooova Admin API is running",
  });
});

// Start Server
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing in .env");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
