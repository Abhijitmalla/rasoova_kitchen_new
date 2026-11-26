import express from "express";
import { verifyAdminToken } from "../middleware/authMiddleware.js";
import {
  getAllFoodOrders,
  getFoodOrderById,
  createFoodOrder,
  updateFoodOrder,
  updateFoodOrderStatus,
  deleteFoodOrder,
} from "../controllers/foodOrderController.js";

const router = express.Router();

// Enforce admin token authentication across all food order routes
router.use(verifyAdminToken);

router.get("/", verifyAdminToken, getAllFoodOrders);
router.get("/:id", verifyAdminToken, getFoodOrderById);
router.post("/", verifyAdminToken, createFoodOrder);
router.put("/:id/status", verifyAdminToken, updateFoodOrderStatus);
router.patch("/:id/status", verifyAdminToken, updateFoodOrderStatus);
router.put("/:id", verifyAdminToken, updateFoodOrder);
router.delete("/:id", verifyAdminToken, deleteFoodOrder);

export default router;
