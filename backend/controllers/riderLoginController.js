import db from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// Ensure riders table exists
const ensureRidersTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS riders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rider_code VARCHAR(50) UNIQUE,
        full_name VARCHAR(150) NOT NULL,
        phone VARCHAR(20) NOT NULL UNIQUE,
        vehicle_type VARCHAR(100) DEFAULT 'Motorcycle',
        vehicle_number VARCHAR(50) DEFAULT '',
        delivery_zone VARCHAR(150) DEFAULT 'Bhubaneswar Central',
        password VARCHAR(255) NOT NULL,
        status ENUM('Active', 'Pending', 'Inactive') DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("Ensure riders table error:", err);
  }
};

// Call on load
ensureRidersTable();

// REGISTER RIDER
export const registerRider = async (req, res) => {
  try {
    await ensureRidersTable();
    const {
      fullName,
      phone,
      vehicleType,
      vehicleNumber,
      deliveryZone,
      password
    } = req.body;

    if (!fullName || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Full Name, Phone Number, and Password are required."
      });
    }

    const cleanPhone = String(phone).trim().replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit phone number."
      });
    }

    // Check if rider already exists
    const [existing] = await db.query(
      "SELECT id FROM riders WHERE phone = ? LIMIT 1",
      [cleanPhone]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "A rider is already registered with this phone number."
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const riderCode = `RDR-${Math.floor(1000 + Math.random() * 9000)}`;

    const [result] = await db.query(
      `INSERT INTO riders (rider_code, full_name, phone, vehicle_type, vehicle_number, delivery_zone, password, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')`,
      [
        riderCode,
        String(fullName).trim(),
        cleanPhone,
        vehicleType ? String(vehicleType).trim() : "Motorcycle",
        vehicleNumber ? String(vehicleNumber).trim() : "",
        deliveryZone ? String(deliveryZone).trim() : "Bhubaneswar Central",
        hashedPassword
      ]
    );

    const token = jwt.sign(
      {
        id: result.insertId,
        phone: cleanPhone,
        role: "rider",
        name: String(fullName).trim()
      },
      process.env.JWT_SECRET || "rasoova_rider_secret_key_2026",
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success: true,
      message: "Rider registered successfully!",
      token,
      rider: {
        id: result.insertId,
        rider_code: riderCode,
        full_name: String(fullName).trim(),
        phone: cleanPhone,
        vehicle_type: vehicleType || "Motorcycle",
        vehicle_number: vehicleNumber || "",
        delivery_zone: deliveryZone || "Bhubaneswar Central",
        status: "Active"
      }
    });
  } catch (error) {
    console.error("Rider Register Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during registration."
    });
  }
};

// LOGIN RIDER
export const loginRider = async (req, res) => {
  try {
    await ensureRidersTable();
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone number and password are required."
      });
    }

    const cleanPhone = String(phone).trim().replace(/\D/g, "");

    const [riders] = await db.query(
      "SELECT * FROM riders WHERE phone = ? LIMIT 1",
      [cleanPhone]
    );

    if (!riders || riders.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password."
      });
    }

    const rider = riders[0];
    const isPasswordValid = await bcrypt.compare(password, rider.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password."
      });
    }

    const token = jwt.sign(
      {
        id: rider.id,
        phone: rider.phone,
        role: "rider",
        name: rider.full_name
      },
      process.env.JWT_SECRET || "rasoova_rider_secret_key_2026",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful!",
      token,
      rider: {
        id: rider.id,
        rider_code: rider.rider_code,
        full_name: rider.full_name,
        phone: rider.phone,
        vehicle_type: rider.vehicle_type,
        vehicle_number: rider.vehicle_number,
        delivery_zone: rider.delivery_zone,
        status: rider.status
      }
    });
  } catch (error) {
    console.error("Rider Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during rider login."
    });
  }
};
