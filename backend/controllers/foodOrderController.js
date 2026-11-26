import db from "../db.js";

const DEFAULT_THUMB =
  "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=120&q=80";
const VALID_STATUSES = ["Pending", "Preparing", "Dispatched", "Delivered"];

// Helper: strip "₹" or commas and parse numeric amount
const parseAmount = (rawAmount) => {
  if (rawAmount === undefined || rawAmount === null) return NaN;
  const cleaned = String(rawAmount).replace(/[₹,\s]/g, "");
  return parseFloat(cleaned);
};

// Helper: check if request is authenticated
const requireAdmin = (req, res) => {
  if (!req.admin || req.admin.role !== "admin") {
    res.status(401).json({
      success: false,
      message: "Access denied. Authentication token required.",
    });
    return false;
  }
  return true;
};

// GET ALL FOOD ORDERS + 5 DASHBOARD STAT CARDS
export const getAllFoodOrders = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const {
      search = "",
      status = "All",
      location = "All",
      startDate = "",
      endDate = "",
    } = req.query;

    let query = "SELECT * FROM food_orders WHERE 1=1";
    const params = [];

    if (search && search.trim()) {
      query +=
        " AND (order_code LIKE ? OR food_code LIKE ? OR food_item LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR address_line1 LIKE ? OR address_line2 LIKE ?)";
      const keyword = `%${search.trim()}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword);
    }

    if (status && status !== "All" && status !== "all") {
      query += " AND LOWER(status) = LOWER(?)";
      params.push(status.trim());
    }

    if (location && location !== "All" && location !== "all") {
      query += " AND LOWER(address_line1) LIKE LOWER(?)";
      params.push(`%${location.trim()}%`);
    }

    if (startDate && startDate.trim()) {
      query += " AND DATE(order_datetime) >= ?";
      params.push(startDate.trim());
    }

    if (endDate && endDate.trim()) {
      query += " AND DATE(order_datetime) <= ?";
      params.push(endDate.trim());
    }

    query += " ORDER BY id DESC";

    const [orders] = await db.query(query, params);

    // 5 Stat Card metrics
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS totalOrders,
        COALESCE(SUM(status = 'Pending'), 0) AS pendingOrders,
        COALESCE(SUM(status = 'Preparing'), 0) AS preparingOrders,
        COALESCE(SUM(status = 'Dispatched'), 0) AS dispatchedOrders,
        COALESCE(SUM(status = 'Delivered'), 0) AS deliveredOrders
      FROM food_orders
    `);

    return res.status(200).json({
      success: true,
      stats: {
        totalOrders: Number(stats?.totalOrders || 0),
        pending: Number(stats?.pendingOrders || 0),
        preparing: Number(stats?.preparingOrders || 0),
        dispatched: Number(stats?.dispatchedOrders || 0),
        delivered: Number(stats?.deliveredOrders || 0),
      },
      orders,
    });
  } catch (error) {
    console.error("Get Food Orders Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch food orders",
      error: error.message,
    });
  }
};

// GET SINGLE FOOD ORDER BY ID OR ORDER CODE
export const getFoodOrderById = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM food_orders WHERE id = ? OR order_code = ? LIMIT 1",
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food order not found",
      });
    }

    return res.status(200).json({
      success: true,
      order: rows[0],
    });
  } catch (error) {
    console.error("Get Single Food Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// CREATE NEW MANUAL FOOD ORDER
export const createFoodOrder = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    let {
      order_code,
      food_code,
      code,
      food_item,
      item,
      thumb,
      customer_id = null,
      customer_name,
      customer,
      phone,
      address,
      address_line1,
      address_line2,
      order_datetime,
      amount,
      status = "Preparing",
    } = req.body;

    // Support property aliases
    customer_name = customer_name || customer;
    food_item = food_item || item;
    food_code = food_code || code;

    // Support single address string or split lines
    let line1 = address_line1 ? address_line1.trim() : "";
    let line2 = address_line2 ? address_line2.trim() : "";

    if (!line1 && address) {
      const pinMatch = address.match(/(Pin\s*-?\s*\d{6}|\b\d{6}\b)/i);
      if (pinMatch) {
        const rawPin = pinMatch[0].replace(/pin\s*-?\s*/i, "").trim();
        line2 = `Pin - ${rawPin}`;
        line1 = address.replace(pinMatch[0], "").replace(/,\s*$/, "").trim();
      } else {
        const parts = address.split(",");
        line1 = parts[0]?.trim() || address.trim();
        line2 = parts.slice(1).join(",").trim() || "Bhubaneswar";
      }
    }

    if (!customer_name || !phone || !food_item || !line1 || amount === undefined || amount === "") {
      return res.status(400).json({
        success: false,
        message:
          "Customer name, phone, food item, delivery address, and amount are required",
      });
    }

    const numericAmount = parseAmount(amount);
    if (isNaN(numericAmount) || numericAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid order amount",
      });
    }

    // Auto-generate order_code (e.g. ORD-1025) if omitted
    if (!order_code || !order_code.trim()) {
      const [[lastRow]] = await db.query(
        "SELECT COALESCE(MAX(id), 0) + 1020 AS nextNum FROM food_orders"
      );
      order_code = `ORD-${lastRow.nextNum}`;
    } else {
      order_code = order_code.trim().toUpperCase();
    }

    const [dupOrder] = await db.query(
      "SELECT id FROM food_orders WHERE order_code = ? LIMIT 1",
      [order_code]
    );
    if (dupOrder.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Order code ${order_code} already exists`,
      });
    }

    // Resolve food_code & thumbnail from food_items if matching item exists
    const baseFoodName = food_item.split("×")[0].split("x")[0].trim();
    let resolvedFoodCode = food_code ? food_code.trim().toUpperCase() : "";
    let resolvedThumb = thumb && thumb.trim() ? thumb.trim() : DEFAULT_THUMB;

    if (resolvedFoodCode) {
      const [foodRows] = await db.query(
        "SELECT food_code, image FROM food_items WHERE food_code = ? LIMIT 1",
        [resolvedFoodCode]
      );
      if (foodRows.length > 0 && (!thumb || !thumb.trim())) {
        resolvedThumb = foodRows[0].image || DEFAULT_THUMB;
      }
    } else {
      const [foodByName] = await db.query(
        "SELECT food_code, image FROM food_items WHERE LOWER(name) = LOWER(?) LIMIT 1",
        [baseFoodName]
      );
      if (foodByName.length > 0) {
        resolvedFoodCode = foodByName[0].food_code;
        if (!thumb || !thumb.trim()) {
          resolvedThumb = foodByName[0].image || DEFAULT_THUMB;
        }
      } else {
        resolvedFoodCode = "FD-001";
      }
    }

    // Link customer by customer_id or phone if existing in customers table
    let resolvedCustomerId = customer_id ? Number(customer_id) : null;
    if (!resolvedCustomerId && phone) {
      const [custByPhone] = await db.query(
        "SELECT id FROM customers WHERE phone = ? LIMIT 1",
        [phone.trim()]
      );
      if (custByPhone.length > 0) {
        resolvedCustomerId = custByPhone[0].id;
      }
    }

    const matchedStatus = VALID_STATUSES.find(
      (s) => s.toLowerCase() === String(status).trim().toLowerCase()
    );
    const finalStatus = matchedStatus || "Preparing";
    const orderDateVal = order_datetime ? new Date(order_datetime) : new Date();

    const [result] = await db.query(
      `INSERT INTO food_orders (
        order_code, food_code, food_item, thumb, customer_id, customer_name,
        phone, address_line1, address_line2, order_datetime, amount, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order_code,
        resolvedFoodCode,
        food_item.trim(),
        resolvedThumb,
        resolvedCustomerId,
        customer_name.trim(),
        phone.trim(),
        line1,
        line2 || "Bhubaneswar",
        orderDateVal,
        numericAmount,
        finalStatus,
      ]
    );

    // Increment total_orders on linked customer if matched
    if (resolvedCustomerId) {
      await db.query(
        "UPDATE customers SET total_orders = total_orders + 1 WHERE id = ?",
        [resolvedCustomerId]
      );
    }

    const [created] = await db.query("SELECT * FROM food_orders WHERE id = ?", [
      result.insertId,
    ]);

    return res.status(201).json({
      success: true,
      message: `Order #${order_code} created successfully`,
      order: created[0],
    });
  } catch (error) {
    console.error("Create Food Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create food order",
      error: error.message,
    });
  }
};

// UPDATE FOOD ORDER BY ID OR ORDER CODE
export const updateFoodOrder = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const {
      food_code,
      code,
      food_item,
      item,
      thumb,
      customer_name,
      customer,
      phone,
      address_line1,
      address_line2,
      address,
      amount,
      status,
    } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM food_orders WHERE id = ? OR order_code = ? LIMIT 1",
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food order not found",
      });
    }

    const current = rows[0];

    const updatedFoodCode = (food_code || code)
      ? String(food_code || code).trim().toUpperCase()
      : current.food_code;
    const updatedFoodItem = (food_item || item)
      ? String(food_item || item).trim()
      : current.food_item;
    const updatedThumb =
      thumb !== undefined ? String(thumb).trim() || DEFAULT_THUMB : current.thumb;
    const updatedCustomer = (customer_name || customer)
      ? String(customer_name || customer).trim()
      : current.customer_name;
    const updatedPhone = phone ? String(phone).trim() : current.phone;

    let updatedLine1 = current.address_line1;
    let updatedLine2 = current.address_line2;

    if (address_line1 !== undefined) {
      updatedLine1 = String(address_line1).trim();
    }
    if (address_line2 !== undefined) {
      updatedLine2 = String(address_line2).trim();
    }
    if (!address_line1 && address) {
      const parts = String(address).split(",");
      updatedLine1 = parts[0]?.trim() || address.trim();
      updatedLine2 = parts.slice(1).join(",").trim() || current.address_line2;
    }

    let updatedAmount = current.amount;
    if (amount !== undefined && amount !== "") {
      const parsed = parseAmount(amount);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid amount",
        });
      }
      updatedAmount = parsed;
    }

    let updatedStatus = current.status;
    if (status !== undefined) {
      const matched = VALID_STATUSES.find(
        (s) => s.toLowerCase() === String(status).trim().toLowerCase()
      );
      if (!matched) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${VALID_STATUSES.join(", ")}`,
        });
      }
      updatedStatus = matched;
    }

    await db.query(
      `UPDATE food_orders
       SET food_code = ?, food_item = ?, thumb = ?, customer_name = ?,
           phone = ?, address_line1 = ?, address_line2 = ?, amount = ?, status = ?
       WHERE id = ?`,
      [
        updatedFoodCode,
        updatedFoodItem,
        updatedThumb,
        updatedCustomer,
        updatedPhone,
        updatedLine1,
        updatedLine2,
        updatedAmount,
        updatedStatus,
        current.id,
      ]
    );

    const [updatedRows] = await db.query(
      "SELECT * FROM food_orders WHERE id = ?",
      [current.id]
    );

    return res.status(200).json({
      success: true,
      message: `Order ${current.order_code} updated successfully`,
      order: updatedRows[0],
    });
  } catch (error) {
    console.error("Update Food Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update food order",
      error: error.message,
    });
  }
};

// UPDATE ORDER STATUS ONLY (e.g. from SweetAlert Modal)
export const updateFoodOrderStatus = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const { status } = req.body;

    const matched = VALID_STATUSES.find(
      (s) => s.toLowerCase() === String(status).trim().toLowerCase()
    );

    if (!matched) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const [rows] = await db.query(
      "SELECT * FROM food_orders WHERE id = ? OR order_code = ? LIMIT 1",
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food order not found",
      });
    }

    const order = rows[0];
    await db.query("UPDATE food_orders SET status = ? WHERE id = ?", [
      matched,
      order.id,
    ]);

    return res.status(200).json({
      success: true,
      message: `Order ${order.order_code} is now marked as ${matched}`,
      order: {
        ...order,
        status: matched,
      },
    });
  } catch (error) {
    console.error("Update Order Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message,
    });
  }
};

// DELETE FOOD ORDER BY ID OR ORDER CODE
export const deleteFoodOrder = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT * FROM food_orders WHERE id = ? OR order_code = ? LIMIT 1",
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Food order not found",
      });
    }

    const order = rows[0];
    await db.query("DELETE FROM food_orders WHERE id = ?", [order.id]);

    return res.status(200).json({
      success: true,
      message: `Order ${order.order_code} has been removed`,
    });
  } catch (error) {
    console.error("Delete Food Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete food order",
      error: error.message,
    });
  }
};
