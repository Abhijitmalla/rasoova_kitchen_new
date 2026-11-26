import express from "express";
import { verifyAdminToken } from "../middleware/authMiddleware.js";
import {
  getAllSubscriptions,
  getSubscriptionById,
  createSubscription,
  updateSubscription,
  updateSubscriptionCalendar,
  deleteSubscription,
} from "../controllers/subscriptionController.js";

const router = express.Router();

// Protect all subscription routes with Admin JWT
router.use(verifyAdminToken);

router.get("/", getAllSubscriptions);
router.get("/:id", getSubscriptionById);
router.post("/", createSubscription);
router.put("/:id", updateSubscription);
router.patch("/:id/calendar", updateSubscriptionCalendar);
router.delete("/:id", deleteSubscription);

export default router;