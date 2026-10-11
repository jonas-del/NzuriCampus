"use strict";

const express = require("express");
const requireAdmin = require("../middleware/require-admin");

const normalizeBoolean = value => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
};

const serializeVenue = row => ({
  id: Number(row.id),
  name: row.name,
  building: row.building,
  capacity: Number(row.capacity),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at
});

const serializeBooking = row => ({
  id: Number(row.id),
  venueId: Number(row.venue_id),
  venueName: row.venue_name || null,
  venueBuilding: row.venue_building || null,
  requesterEmail: row.requester_email,
  eventTitle: row.event_title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  createdAt: row.created_at
});

const isCampusWeekend = date => ["Sat", "Sun"].includes(
  new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Nairobi", weekday: "short" }).format(date)
);

const getSummary = async pool => {
  const isWeekend = isCampusWeekend(new Date());
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM venues WHERE is_active = TRUE) AS total_venues,
      (SELECT COUNT(*)
         FROM venues v
        WHERE v.is_active = TRUE
          AND ($1::boolean OR NOT EXISTS (
            SELECT 1
              FROM bookings b
             WHERE b.venue_id = v.id
               AND b.status = 'approved'
               AND b.starts_at <= NOW()
               AND b.ends_at > NOW()
          ))) AS available_venues,
      (SELECT COUNT(DISTINCT b.venue_id)
         FROM bookings b
         JOIN venues v ON v.id = b.venue_id
        WHERE v.is_active = TRUE
          AND b.status = 'approved'
          AND b.starts_at <= NOW()
          AND b.ends_at > NOW()
          AND $1::boolean = FALSE) AS occupied_venues,
      (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending_bookings,
      (SELECT COUNT(*) FROM bookings WHERE status = 'approved') AS approved_bookings,
      (SELECT COUNT(*) FROM bookings WHERE status = 'rejected') AS rejected_bookings,
      (SELECT COUNT(*) FROM bookings) AS total_bookings,
      (SELECT COUNT(DISTINCT NULLIF(BTRIM(building), ''))
         FROM venues WHERE is_active = TRUE) AS building_count,
      (SELECT COALESCE(ROUND(AVG(capacity)), 0)
         FROM venues WHERE is_active = TRUE) AS average_capacity
  `, [isWeekend]);
  const row = rows[0];
  return {
    totalVenues: Number(row.total_venues),
    availableVenues: Number(row.available_venues),
    occupiedVenues: Number(row.occupied_venues),
    pendingBookings: Number(row.pending_bookings),
    approvedBookings: Number(row.approved_bookings),
    rejectedBookings: Number(row.rejected_bookings),
    totalBookings: Number(row.total_bookings),
    buildingCount: Number(row.building_count),
    averageCapacity: Number(row.average_capacity)
  };
};

const createPublicRouter = pool => {
  const router = express.Router();

  router.get("/venues", async (req, res, next) => {
    try {
      if (!pool) {
        res.status(200).json({
          success: true,
          configured: false,
          venues: []
        });
        return;
      }

      const { rows } = await pool.query(`
        SELECT id, name, building, capacity, is_active, created_at
          FROM venues
         WHERE is_active = TRUE
         ORDER BY name ASC
      `);

      res.status(200).json({
        success: true,
        configured: true,
        venues: rows.map(serializeVenue)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/venues/summary", async (req, res, next) => {
    try {
      if (!pool) {
        res.status(200).json({
          success: true,
          configured: false,
          summary: null
        });
        return;
      }

      const summary = await getSummary(pool);
      res.status(200).json({ success: true, configured: true, summary });
    } catch (error) {
      next(error);
    }
  });

  router.get("/venues/availability", async (req, res, next) => {
    try {
      if (!pool) {
        res.status(200).json({
          success: true,
          configured: false,
          available: [],
          message: "Availability will appear after the site is connected to its database."
        });
        return;
      }

      const requestedStarts = req.query.startsAt || req.query.start || req.query.date || "";
      const requestedEnds = req.query.endsAt || req.query.end || "";
      const capacity = Number(req.query.capacity || "0");

      if (!requestedStarts && !requestedEnds) {
        const { rows } = await pool.query(`
          SELECT id, name, building, capacity, is_active, created_at
            FROM venues
           WHERE is_active = TRUE
             AND capacity >= $1
           ORDER BY capacity DESC, name ASC
        `, [Number.isFinite(capacity) && capacity >= 0 ? capacity : 0]);

        res.status(200).json({ success: true, configured: true, venues: rows.map(serializeVenue) });
        return;
      }

      const startsAt = new Date(requestedStarts);
      const endsAt = new Date(requestedEnds || requestedStarts);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        res.status(400).json({
          success: false,
          configured: true,
          message: "Provide valid startsAt and endsAt values where the end time is later than the start time."
        });
        return;
      }

      const { rows } = await pool.query(`
        SELECT v.id, v.name, v.building, v.capacity, v.is_active, v.created_at
          FROM venues v
          LEFT JOIN bookings b
            ON b.venue_id = v.id
           AND b.status = 'approved'
           AND b.starts_at < $2
           AND b.ends_at > $1
           AND $4::boolean = FALSE
         WHERE v.is_active = TRUE
           AND v.capacity >= $3
           AND b.id IS NULL
         ORDER BY v.capacity DESC, v.name ASC
      `, [
        startsAt.toISOString(),
        endsAt.toISOString(),
        Number.isFinite(capacity) && capacity >= 0 ? capacity : 0,
        isCampusWeekend(startsAt)
      ]);

      res.status(200).json({
        success: true,
        configured: true,
        available: rows.map(serializeVenue),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bookings", async (req, res, next) => {
    try {
      if (!pool) {
        res.status(503).json({
          success: false,
          configured: false,
          message: "Booking requests are available after the site is connected to its database."
        });
        return;
      }

      const body = req.body || {};
      const venueId = Number(body.venueId ?? body.venue_id ?? body.venue ?? 0);
      const requesterEmail = typeof body.requesterEmail === "string"
        ? body.requesterEmail.trim().toLowerCase()
        : typeof body.requester_email === "string"
          ? body.requester_email.trim().toLowerCase()
          : "";
      const eventTitle = typeof body.eventTitle === "string"
        ? body.eventTitle.trim()
        : typeof body.event_title === "string"
          ? body.event_title.trim()
          : "";
      const startsAt = body.startsAt || body.starts_at || "";
      const endsAt = body.endsAt || body.ends_at || "";
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail);
      const startDate = new Date(startsAt);
      const endDate = new Date(endsAt);

      if (!Number.isInteger(venueId) || venueId <= 0 || !validEmail || !eventTitle || !startsAt || !endsAt) {
        res.status(400).json({
          success: false,
          configured: true,
          message: "Provide a valid venue, email, event title, and start/end times."
        });
        return;
      }

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
        res.status(400).json({
          success: false,
          configured: true,
          message: "The booking end time must be later than the booking start time."
        });
        return;
      }

      const venueResult = await pool.query(
        "SELECT id, name, building, capacity, is_active FROM venues WHERE id = $1 AND is_active = TRUE LIMIT 1",
        [venueId]
      );
      const venue = venueResult.rows[0];
      if (!venue) {
        res.status(404).json({ success: false, configured: true, message: "Venue not found or inactive." });
        return;
      }

      const conflictResult = isCampusWeekend(startDate)
        ? { rows: [] }
        : await pool.query(
          `SELECT id FROM bookings
            WHERE venue_id = $1
              AND status = 'approved'
              AND starts_at < $3
              AND ends_at > $2
            LIMIT 1`,
          [venueId, startDate.toISOString(), endDate.toISOString()]
        );

      if (conflictResult.rows.length > 0) {
        res.status(409).json({
          success: false,
          configured: true,
          message: "This venue is already approved for that time range."
        });
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO bookings (venue_id, requester_email, event_title, starts_at, ends_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [venueId, requesterEmail, eventTitle, startDate.toISOString(), endDate.toISOString()]
      );

      res.status(201).json({
        success: true,
        configured: true,
        booking: serializeBooking(rows[0])
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

const createAdminRouter = pool => {
  const router = express.Router();

  router.get("/summary", requireAdmin, async (req, res, next) => {
    try {
      const summary = await getSummary(pool);
      res.status(200).json({ success: true, summary });
    } catch (error) {
      next(error);
    }
  });

  router.get("/availability", requireAdmin, async (req, res, next) => {
    try {
      const startsAt = new Date(req.query.startsAt || "");
      const endsAt = new Date(req.query.endsAt || "");
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        res.status(400).json({
          success: false,
          message: "Provide valid startsAt and endsAt values where the end time is later than the start time."
        });
        return;
      }

      const { rows } = await pool.query(`
        SELECT v.id, v.name, v.building, v.capacity, v.is_active, v.created_at,
               CASE WHEN $3::boolean THEN TRUE ELSE NOT EXISTS (
                 SELECT 1
                   FROM bookings b
                  WHERE b.venue_id = v.id
                    AND b.status = 'approved'
                    AND b.starts_at < $2
                    AND b.ends_at > $1
               ) END AS is_available,
               CASE WHEN $4::boolean THEN FALSE ELSE EXISTS (
                 SELECT 1
                   FROM bookings b
                  WHERE b.venue_id = v.id
                    AND b.status = 'approved'
                    AND b.starts_at <= NOW()
                    AND b.ends_at > NOW()
               ) END AS is_in_use
          FROM venues v
         WHERE v.is_active = TRUE
         ORDER BY v.name ASC
      `, [startsAt.toISOString(), endsAt.toISOString(), isCampusWeekend(startsAt), isCampusWeekend(new Date())]);

      res.status(200).json({
        success: true,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        isWeekend: isCampusWeekend(startsAt),
        venues: rows.map(row => ({
          ...serializeVenue(row),
          isAvailable: Boolean(row.is_available),
          isInUse: Boolean(row.is_in_use)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/venues", requireAdmin, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, name, building, capacity, is_active, created_at
          FROM venues
         ORDER BY is_active DESC, name ASC
      `);

      res.status(200).json({
        success: true,
        venues: rows.map(serializeVenue)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/venues", requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const building = typeof body.building === "string" ? body.building.trim() : "";
      const capacity = Number(body.capacity);
      const isActive = normalizeBoolean(body.isActive ?? body.is_active ?? true);

      if (!name || name.length > 150 || building.length > 150 || !Number.isInteger(capacity) || capacity < 0 || isActive === undefined) {
        res.status(400).json({
          success: false,
          message: "Provide a valid venue name, building, capacity, and activity status."
        });
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO venues (name, building, capacity, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [name, building, capacity, isActive]
      );

      res.status(201).json({ success: true, venue: serializeVenue(rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/venues/:id", requireAdmin, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, message: "Venue id must be a positive integer." });
        return;
      }

      const body = req.body || {};
      const updates = [];
      const values = [];

      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        const value = typeof body.name === "string" ? body.name.trim() : "";
        if (!value || value.length > 150) {
          res.status(400).json({ success: false, message: "Venue name must be 1-150 characters." });
          return;
        }
        updates.push("name = $" + (values.length + 1));
        values.push(value);
      }

      if (Object.prototype.hasOwnProperty.call(body, "building")) {
        const value = typeof body.building === "string" ? body.building.trim() : "";
        if (value.length > 150) {
          res.status(400).json({ success: false, message: "Building name cannot exceed 150 characters." });
          return;
        }
        updates.push("building = $" + (values.length + 1));
        values.push(value);
      }

      if (Object.prototype.hasOwnProperty.call(body, "capacity")) {
        const value = Number(body.capacity);
        if (!Number.isInteger(value) || value < 0) {
          res.status(400).json({ success: false, message: "Capacity must be a non-negative integer." });
          return;
        }
        updates.push("capacity = $" + (values.length + 1));
        values.push(value);
      }

      if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
        const value = normalizeBoolean(body.isActive ?? body.is_active);
        if (value === undefined) {
          res.status(400).json({ success: false, message: "isActive must be a boolean value." });
          return;
        }
        updates.push("is_active = $" + (values.length + 1));
        values.push(value);
      }

      if (updates.length === 0) {
        res.status(400).json({ success: false, message: "No venue changes were provided." });
        return;
      }

      values.push(id);
      const { rows } = await pool.query(
        `UPDATE venues
            SET ${updates.join(", ")}
          WHERE id = $${values.length}
          RETURNING *`,
        values
      );

      if (!rows[0]) {
        res.status(404).json({ success: false, message: "Venue not found." });
        return;
      }

      res.status(200).json({ success: true, venue: serializeVenue(rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/venues/:id", requireAdmin, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, message: "Venue id must be a positive integer." });
        return;
      }

      const { rows } = await pool.query(
        `UPDATE venues
            SET is_active = FALSE
          WHERE id = $1
          RETURNING *`,
        [id]
      );

      if (!rows[0]) {
        res.status(404).json({ success: false, message: "Venue not found." });
        return;
      }

      res.status(200).json({ success: true, venue: serializeVenue(rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/bookings", requireAdmin, async (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
      const filters = [];
      const values = [];

      if (["pending", "approved", "rejected"].includes(status)) {
        filters.push("b.status = $" + (values.length + 1));
        values.push(status);
      }

      const query = `
        SELECT b.id, b.venue_id, b.requester_email, b.event_title, b.starts_at, b.ends_at, b.status, b.created_at,
               v.name AS venue_name, v.building AS venue_building
          FROM bookings b
          JOIN venues v ON v.id = b.venue_id
          ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
         ORDER BY b.starts_at DESC, b.created_at DESC
      `;

      const { rows } = await pool.query(query, values);
      res.status(200).json({ success: true, bookings: rows.map(serializeBooking) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/bookings/:id/status", requireAdmin, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const status = typeof req.body?.status === "string" ? req.body.status.trim().toLowerCase() : "";

      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, message: "Booking id must be a positive integer." });
        return;
      }

      if (!["pending", "approved", "rejected"].includes(status)) {
        res.status(400).json({ success: false, message: "Status must be pending, approved, or rejected." });
        return;
      }

      if (status === "approved") {
        const bookingResult = await pool.query(
          "SELECT id, venue_id, starts_at, ends_at FROM bookings WHERE id = $1 LIMIT 1",
          [id]
        );
        const booking = bookingResult.rows[0];
        if (!booking) {
          res.status(404).json({ success: false, message: "Booking not found." });
          return;
        }

        if (!isCampusWeekend(new Date(booking.starts_at))) {
          const conflictResult = await pool.query(
            `SELECT id FROM bookings
              WHERE venue_id = $1
                AND id <> $2
                AND status = 'approved'
                AND starts_at < $4
                AND ends_at > $3
              LIMIT 1`,
            [booking.venue_id, id, booking.starts_at, booking.ends_at]
          );
          if (conflictResult.rows.length > 0) {
            res.status(409).json({
              success: false,
              message: "This venue already has an approved booking during that time."
            });
            return;
          }
        }
      }

      const { rows } = await pool.query(
        `UPDATE bookings
            SET status = $1
          WHERE id = $2
          RETURNING *`,
        [status, id]
      );

      if (!rows[0]) {
        res.status(404).json({ success: false, message: "Booking not found." });
        return;
      }

      res.status(200).json({ success: true, booking: serializeBooking(rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

module.exports = createAdminRouter;
module.exports.createPublicRouter = createPublicRouter;
