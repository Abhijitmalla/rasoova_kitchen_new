import db from "../db.js";

const VALID_PLANS = ["None", "Weekly", "Monthly"];
const VALID_SUBSCRIPTIONS = ["None", "Active", "Paused"];
const VALID_STATUSES = ["Active", "Inactive"];

// GET ALL CUSTOMERS + 4 DASHBOARD STAT CARDS
export const getAllCustomers = async (req, res) => {
  try {
    const {
      search = "",
      status = "All",
      subscription = "All",
      location = "All",
    } = req.query;

    let query = "SELECT * FROM customers WHERE 1=1";
    const params = [];

    if (search.trim()) {
      query +=
        " AND (customer_code LIKE ? OR name LIKE ? OR phone LIKE ? OR location LIKE ? OR pin LIKE ?)";
      const keyword = `%${search.trim()}%`;
      params.push(keyword, keyword, keyword, keyword, keyword);
    }

    if (status && status !== "All") {
      query += " AND LOWER(status) = LOWER(?)";
      params.push(status.trim());
    }

    if (subscription && subscription !== "All") {
      query += " AND LOWER(subscription) = LOWER(?)";
      params.push(subscription.trim());
    }

    if (location && location !== "All") {
      query += " AND LOWER(location) LIKE LOWER(?)";
      params.push(`%${location.trim()}%`);
    }

    query += " ORDER BY id DESC";

    const [customers] = await db.query(query, params);

    // Stats for the 4 cards
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS totalCustomers,
        COALESCE(SUM(status = 'Active'), 0) AS activeCustomers,
        COALESCE(SUM(subscription IN ('Active', 'Paused')), 0) AS subscriptionUsers,
        COALESCE(SUM(status = 'Inactive'), 0) AS inactiveCustomers
      FROM customers
    `);

    return res.status(200).json({
      success: true,
      stats: {
        totalCustomers: Number(stats.totalCustomers),
        activeCustomers: Number(stats.activeCustomers),
        subscriptionUsers: Number(stats.subscriptionUsers),
        inactiveCustomers: Number(stats.inactiveCustomers),
      },
      customers,
    });
  } catch (error) {
    console.error("Get Customers Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
    });
  }
};

// GET SINGLE CUSTOMER BY ID
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM customers WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      customer: rows[0],
    });
  } catch (error) {
    console.error("Get Single Customer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// CREATE NEW CUSTOMER
export const createCustomer = async (req, res) => {
  try {
    let {
      customer_code,
      name,
      phone,
      location,
      pin,
      total_orders = 0,
      plan = "None",
      subscription = "None",
      status = "Active",
    } = req.body;

    if (!name || !phone || !location || !pin) {
      return res.status(400).json({
        success: false,
        message: "Name, phone, location, and PIN code are required",
      });
    }

    const cleanPhone = phone.trim();

    // Check duplicate phone
    const [existingPhone] = await db.query(
      "SELECT id FROM customers WHERE phone = ? LIMIT 1",
      [cleanPhone]
    );
    if (existingPhone.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Phone number ${cleanPhone} is already registered`,
      });
    }

    // Auto-generate customer_code (e.g. CUST-1006) if omitted
    if (!customer_code || !customer_code.trim()) {
      const [[lastRow]] = await db.query(
        "SELECT COALESCE(MAX(id), 0) + 1001 AS nextNum FROM customers"
      );
      customer_code = `CUST-${lastRow.nextNum}`;
    } else {
      customer_code = customer_code.trim().toUpperCase();
    }

    const [existingCode] = await db.query(
      "SELECT id FROM customers WHERE customer_code = ? LIMIT 1",
      [customer_code]
    );
    if (existingCode.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Customer code ${customer_code} already exists`,
      });
    }

    const finalPlan = VALID_PLANS.includes(plan) ? plan : "None";
    const finalSub =
      finalPlan === "None"
        ? "None"
        : VALID_SUBSCRIPTIONS.includes(subscription)
        ? subscription
        : "Active";
    const finalStatus = VALID_STATUSES.includes(status) ? status : "Active";
    const ordersCount = Number.isFinite(Number(total_orders))
      ? Math.max(0, parseInt(total_orders, 10))
      : 0;

    const [result] = await db.query(
      `INSERT INTO customers (customer_code, name, phone, location, pin, total_orders, plan, subscription, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer_code,
        name.trim(),
        cleanPhone,
        location.trim(),
        pin.trim(),
        ordersCount,
        finalPlan,
        finalSub,
        finalStatus,
      ]
    );

    const [created] = await db.query("SELECT * FROM customers WHERE id = ?", [
      result.insertId,
    ]);

    return res.status(201).json({
      success: true,
      message: `New customer #${customer_code} created`,
      customer: created[0],
    });
  } catch (error) {
    console.error("Create Customer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create customer",
    });
  }
};

// UPDATE CUSTOMER BY ID
export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_code,
      name,
      phone,
      location,
      pin,
      total_orders,
      plan,
      subscription,
      status,
    } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM customers WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const current = rows[0];
    const updatedCode = customer_code
      ? customer_code.trim().toUpperCase()
      : current.customer_code;
    const updatedPhone = phone ? phone.trim() : current.phone;

    // Check duplicate code or phone on other rows
    if (updatedCode !== current.customer_code) {
      const [dupCode] = await db.query(
        "SELECT id FROM customers WHERE customer_code = ? AND id != ? LIMIT 1",
        [updatedCode, id]
      );
      if (dupCode.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Customer code ${updatedCode} is already in use`,
        });
      }
    }

    if (updatedPhone !== current.phone) {
      const [dupPhone] = await db.query(
        "SELECT id FROM customers WHERE phone = ? AND id != ? LIMIT 1",
        [updatedPhone, id]
      );
      if (dupPhone.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Phone number ${updatedPhone} is already registered to another customer`,
        });
      }
    }

    const updatedName = name ? name.trim() : current.name;
    const updatedLocation = location ? location.trim() : current.location;
    const updatedPin = pin ? pin.trim() : current.pin;
    const updatedOrders =
      total_orders !== undefined && total_orders !== ""
        ? Math.max(0, parseInt(total_orders, 10) || 0)
        : current.total_orders;

    const updatedPlan =
      plan !== undefined && VALID_PLANS.includes(plan) ? plan : current.plan;
    const updatedSub =
      updatedPlan === "None"
        ? "None"
        : subscription !== undefined && VALID_SUBSCRIPTIONS.includes(subscription)
        ? subscription
        : current.subscription;
    const updatedStatus =
      status !== undefined && VALID_STATUSES.includes(status)
        ? status
        : current.status;

    await db.query(
      `UPDATE customers
       SET customer_code = ?, name = ?, phone = ?, location = ?, pin = ?,
           total_orders = ?, plan = ?, subscription = ?, status = ?
       WHERE id = ?`,
      [
        updatedCode,
        updatedName,
        updatedPhone,
        updatedLocation,
        updatedPin,
        updatedOrders,
        updatedPlan,
        updatedSub,
        updatedStatus,
        id,
      ]
    );

    const [updatedRows] = await db.query("SELECT * FROM customers WHERE id = ?", [
      id,
    ]);

    return res.status(200).json({
      success: true,
      message: `Customer #${updatedCode} updated`,
      customer: updatedRows[0],
    });
  } catch (error) {
    console.error("Update Customer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update customer",
    });
  }
};

// DELETE CUSTOMER BY ID
export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT * FROM customers WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const customer = rows[0];
    await db.query("DELETE FROM customers WHERE id = ?", [id]);

    return res.status(200).json({
      success: true,
      message: `Customer ${customer.name} (${customer.customer_code}) removed`,
    });
  } catch (error) {
    console.error("Delete Customer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete customer",
    });
  }
};