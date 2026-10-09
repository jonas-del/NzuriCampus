"use strict";

const express = require("express");
const requireAdmin = require("../middleware/require-admin");

const createAdminRouter = pool => {
  const router = express.Router();

  router.get("/summary", requireAdmin, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM venues WHERE is_active = TRUE) AS total_venues,
          (SELECT COUNT(*)
             FROM venues v
            WHERE v.is_active = TRUE
              AND NOT EXISTS (
                SELECT 1
                  FROM bookings b
                 WHERE b.venue_id = v.id
                   AND b.status = 'approved'
                   AND b.starts_at <= NOW()
                   AND b.ends_at > NOW()
              )) AS available_venues,
          (SELECT COUNT(DISTINCT b.venue_id)
             FROM bookings b
             JOIN venues v ON v.id = b.venue_id
            WHERE v.is_active = TRUE
              AND b.status = 'approved'
              AND b.starts_at <= NOW()
              AND b.ends_at > NOW()) AS occupied_venues,
          (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending_bookings,
          (SELECT COUNT(*) FROM bookings WHERE status = 'approved') AS approved_bookings,
          (SELECT COUNT(*) FROM bookings WHERE status = 'rejected') AS rejected_bookings,
          (SELECT COUNT(*) FROM bookings) AS total_bookings
      `);
      const row = rows[0];
      const summary = {
        totalVenues: Number(row.total_venues),
        availableVenues: Number(row.available_venues),
        occupiedVenues: Number(row.occupied_venues),
        pendingBookings: Number(row.pending_bookings),
        approvedBookings: Number(row.approved_bookings),
        rejectedBookings: Number(row.rejected_bookings),
        totalBookings: Number(row.total_bookings)
      };

      res.status(200).json({ success: true, summary });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

module.exports = createAdminRouter;
