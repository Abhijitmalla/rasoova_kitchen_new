import db from "../db.js";

const DEFAULT_THUMB =
  "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=120&q=80";
const VALID_PLANS = ["Weekly", "Monthly"];
const VALID_STATUSES = ["Active", "Paused"];

// Helper: parse either "YYYY-MM-DD" or "Nov 1, 2026" into "YYYY-MM-DD"
const normalizeDate = (rawDate) => {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// Helper: parse JSON array safely from MySQL JSON/string column
const parseDateArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Helper: format DB row for frontend consistency
const formatSubscription = (row) => ({
  ...row,
  custom_off_dates: parseDateArray(row.custom_off_dates),
  custom_delivery_dates: parseDateArray(row.custom_delivery_dates),
});

// GET ALL SUBSCRIPTIONS + 5 DASHBOARD STAT CARDS
export const getAllSubscriptions = async (req, res) => {
  try {
    const { search = "", plan = "All", status = "All" } = req.query;

    let query = "SELECT * FROM subscriptions WHERE 1=1";
    const params = [];

    if (search.trim()) {
      query +=
        " AND (sub_code LIKE ? OR customer_name LIKE ? OR location LIKE ? OR phone LIKE ? OR food_title LIKE ? OR food_code LIKE ?)";
      const keyword = `%${search.trim()}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword);
    }

    if (plan && plan !== "All" && plan !== "all") {
      query += " AND LOWER(plan_type) = LOWER(?)";
      params.push(plan.trim());
    }

    if (status && status !== "All" && status !== "all") {
      query += " AND LOWER(status) = LOWER(?)";
      params.push(status.trim());
    }

    query += " ORDER BY id DESC";

    const [rows] = await db.query(query, params);

    // 5 Stat Card metrics
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS totalSubscribers,
        COALESCE(SUM(plan_type = 'Weekly'), 0) AS weeklyPlans,
        COALESCE(SUM(plan_type = 'Monthly'), 0) AS monthlyPlans,
        COALESCE(SUM(status = 'Active'), 0) AS activeCount,
        COALESCE(SUM(status = 'Paused'), 0) AS pausedCount
      FROM subscriptions
    `);

    return res.status(200).json({
      success: true,
      stats: {
        totalSubscribers: Number(stats.totalSubscribers),
        weeklyPlans: Number(stats.weeklyPlans),
        monthlyPlans: Number(stats.monthlyPlans),
        active: Number(stats.activeCount),
        paused: Number(stats.pausedCount),
      },
      subscriptions: rows.map(formatSubscription),
    });
  } catch (error) {
    console.error("Get Subscriptions Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscriptions",
    });
  }
};

// GET SINGLE SUBSCRIPTION BY ID
export const getSubscriptionById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    return res.status(200).json({
      success: true,
      subscription: formatSubscription(rows[0]),
    });
  } catch (error) {
    console.error("Get Single Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// CREATE NEW SUBSCRIPTION
export const createSubscription = async (req, res) => {
  try {
    let {
      sub_code,
      customer_id = null,
      customer_name,
      location,
      phone,
      plan_type = "Weekly",
      start_date,
      end_date,
      off_days = "Sun",
      food_title,
      food_code,
      thumb,
      status = "Active",
    } = req.body;

    // Resolve customer details from customers table if customer_id is passed
    let resolvedCustomerId = customer_id ? Number(customer_id) : null;
    if (resolvedCustomerId) {
      const [custRows] = await db.query(
        "SELECT id, name, location, phone FROM customers WHERE id = ? LIMIT 1",
        [resolvedCustomerId]
      );
      if (custRows.length > 0) {
        customer_name = customer_name || custRows[0].name;
        location = location || custRows[0].location;
        phone = phone || custRows[0].phone;
      } else {
        resolvedCustomerId = null;
      }
    }

    if (!customer_name || !location || !phone || !start_date || !end_date || !food_title) {
      return res.status(400).json({
        success: false,
        message:
          "Customer name, location, phone, start date, end date, and food item are required",
      });
    }

    const formattedStart = normalizeDate(start_date);
    const formattedEnd = normalizeDate(end_date);
    if (!formattedStart || !formattedEnd) {
      return res.status(400).json({
        success: false,
        message: "Invalid start date or end date format",
      });
    }

    if (new Date(formattedEnd) < new Date(formattedStart)) {
      return res.status(400).json({
        success: false,
        message: "End date cannot be earlier than start date",
      });
    }

    // Auto-generate sub_code (e.g. SUB-1006) if omitted
    if (!sub_code || !sub_code.trim()) {
      const [[lastRow]] = await db.query(
        "SELECT COALESCE(MAX(id), 0) + 1001 AS nextNum FROM subscriptions"
      );
      sub_code = `SUB-${lastRow.nextNum}`;
    } else {
      sub_code = sub_code.trim().toUpperCase();
    }

    const [dupCode] = await db.query(
      "SELECT id FROM subscriptions WHERE sub_code = ? LIMIT 1",
      [sub_code]
    );
    if (dupCode.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Subscription code ${sub_code} already exists`,
      });
    }

    // Resolve food item thumbnail & code if food_code exists in food_items
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
        [food_title.trim()]
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

    const finalPlan = VALID_PLANS.includes(plan_type) ? plan_type : "Weekly";
    const finalStatus = VALID_STATUSES.includes(status) ? status : "Active";
    const finalOffDays = off_days && off_days.trim() ? off_days.trim() : "None";

    const [result] = await db.query(
      `INSERT INTO subscriptions (
        sub_code, customer_id, customer_name, location, phone, plan_type,
        start_date, end_date, off_days, food_title, food_code, thumb, status,
        custom_off_dates, custom_delivery_dates
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]')`,
      [
        sub_code,
        resolvedCustomerId,
        customer_name.trim(),
        location.trim(),
        phone.trim(),
        finalPlan,
        formattedStart,
        formattedEnd,
        finalOffDays,
        food_title.trim(),
        resolvedFoodCode,
        resolvedThumb,
        finalStatus,
      ]
    );

    // Sync customer's plan & subscription status if linked
    if (resolvedCustomerId) {
      await db.query(
        "UPDATE customers SET plan = ?, subscription = ? WHERE id = ?",
        [finalPlan, finalStatus, resolvedCustomerId]
      );
    }

    const [created] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ?",
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: `Subscription #${sub_code} created successfully`,
      subscription: formatSubscription(created[0]),
    });
  } catch (error) {
    console.error("Create Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create subscription",
    });
  }
};

// UPDATE SUBSCRIPTION BY ID (Status, Plan, Off Days, Dates, Food, etc.)
export const updateSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_name,
      location,
      phone,
      plan_type,
      start_date,
      end_date,
      off_days,
      food_title,
      food_code,
      thumb,
      status,
    } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    const current = rows[0];

    const updatedName = customer_name ? customer_name.trim() : current.customer_name;
    const updatedLocation = location ? location.trim() : current.location;
    const updatedPhone = phone ? phone.trim() : current.phone;
    const updatedPlan =
      plan_type && VALID_PLANS.includes(plan_type) ? plan_type : current.plan_type;
    const updatedStatus =
      status && VALID_STATUSES.includes(status) ? status : current.status;

    const updatedStart = start_date
      ? normalizeDate(start_date) || current.start_date
      : current.start_date;
    const updatedEnd = end_date
      ? normalizeDate(end_date) || current.end_date
      : current.end_date;

    // Reset ad-hoc calendar overrides if regular off_days rule changed
    const offRuleChanged =
      off_days !== undefined && off_days.trim() !== current.off_days;
    const updatedOffDays =
      off_days !== undefined ? off_days.trim() || "None" : current.off_days;

    const updatedFoodTitle = food_title ? food_title.trim() : current.food_title;
    const updatedFoodCode = food_code
      ? food_code.trim().toUpperCase()
      : current.food_code;
    const updatedThumb = thumb !== undefined ? thumb.trim() || DEFAULT_THUMB : current.thumb;

    const customOff = offRuleChanged
      ? "[]"
      : JSON.stringify(parseDateArray(current.custom_off_dates));
    const customDeliv = offRuleChanged
      ? "[]"
      : JSON.stringify(parseDateArray(current.custom_delivery_dates));

    await db.query(
      `UPDATE subscriptions
       SET customer_name = ?, location = ?, phone = ?, plan_type = ?,
           start_date = ?, end_date = ?, off_days = ?, food_title = ?,
           food_code = ?, thumb = ?, status = ?,
           custom_off_dates = ?, custom_delivery_dates = ?
       WHERE id = ?`,
      [
        updatedName,
        updatedLocation,
        updatedPhone,
        updatedPlan,
        updatedStart,
        updatedEnd,
        updatedOffDays,
        updatedFoodTitle,
        updatedFoodCode,
        updatedThumb,
        updatedStatus,
        customOff,
        customDeliv,
        id,
      ]
    );

    if (current.customer_id) {
      await db.query(
        "UPDATE customers SET plan = ?, subscription = ? WHERE id = ?",
        [updatedPlan, updatedStatus, current.customer_id]
      );
    }

    const [updatedRows] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ?",
      [id]
    );

    return res.status(200).json({
      success: true,
      message: `Subscription ${current.sub_code} updated`,
      subscription: formatSubscription(updatedRows[0]),
    });
  } catch (error) {
    console.error("Update Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update subscription",
    });
  }
};

// TOGGLE / UPDATE CUSTOM CALENDAR OFF-DAYS BY ID
export const updateSubscriptionCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const { off_days, custom_off_dates, custom_delivery_dates } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    const current = rows[0];
    const nextOffRule =
      off_days !== undefined ? off_days.trim() || "None" : current.off_days;
    const nextCustomOff = Array.isArray(custom_off_dates)
      ? custom_off_dates
      : parseDateArray(current.custom_off_dates);
    const nextCustomDeliv = Array.isArray(custom_delivery_dates)
      ? custom_delivery_dates
      : parseDateArray(current.custom_delivery_dates);

    await db.query(
      `UPDATE subscriptions
       SET off_days = ?, custom_off_dates = ?, custom_delivery_dates = ?
       WHERE id = ?`,
      [
        nextOffRule,
        JSON.stringify(nextCustomOff),
        JSON.stringify(nextCustomDeliv),
        id,
      ]
    );

    const [updatedRows] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ?",
      [id]
    );

    return res.status(200).json({
      success: true,
      message: `${current.customer_name}'s off-day calendar updated`,
      subscription: formatSubscription(updatedRows[0]),
    });
  } catch (error) {
    console.error("Update Calendar Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update off-day calendar",
    });
  }
};

// DELETE SUBSCRIPTION BY ID
export const deleteSubscription = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT * FROM subscriptions WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    const sub = rows[0];
    await db.query("DELETE FROM subscriptions WHERE id = ?", [id]);

    return res.status(200).json({
      success: true,
      message: `Subscription ${sub.sub_code} has been deleted`,
    });
  } catch (error) {
    console.error("Delete Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete subscription",
    });
  }
};