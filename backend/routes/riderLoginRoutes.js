import express from "express";
import { registerRider, loginRider } from "../controllers/riderLoginController.js";

const router = express.Router();

router.post("/register", registerRider);
router.post("/login", loginRider);

export default router;
