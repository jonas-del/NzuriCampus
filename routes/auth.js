"use strict";

const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcryptjs");

const createAuthRouter = ({ pool, getSetupKey }) => {
  const router = express.Router();

  router.post("/login", async (req, res, next) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
      const password = typeof body.password === "string"
        ? body.password
        : "";

      if (!email || !password || Buffer.byteLength(password, "utf8") > 72) {
        res.status(400).json({
          success: false,
          message: "Enter a valid email address and password."
        });
        return;
      }

      const { rows } = await pool.query(
        "SELECT id, name, email, password_hash FROM admins WHERE email = $1 LIMIT 1",
        [email]
      );
      const admin = rows[0];

      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        res.status(401).json({
          success: false,
          message: "Email or password is incorrect."
        });
        return;
      }

      await new Promise((resolve, reject) => {
        req.session.regenerate(error => error ? reject(error) : resolve());
      });

      req.session.adminId = admin.id;
      req.session.adminName = admin.name;
      req.session.adminEmail = admin.email;
      req.session.cookie.maxAge = body.remember === true
        ? 14 * 24 * 60 * 60 * 1000
        : null;

      await new Promise((resolve, reject) => {
        req.session.save(error => error ? reject(error) : resolve());
      });

      res.status(200).json({
        success: true,
        admin: { id: admin.id, name: admin.name, email: admin.email }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", (req, res) => {
    if (!req.session || !req.session.adminId) {
      res.status(401).json({ success: false, message: "Not signed in." });
      return;
    }

    res.status(200).json({
      success: true,
      admin: {
        id: req.session.adminId,
        name: req.session.adminName,
        email: req.session.adminEmail
      }
    });
  });

  router.post("/logout", (req, res, next) => {
    if (!req.session) {
      res.status(200).json({ success: true });
      return;
    }

    req.session.destroy(error => {
      if (error) {
        next(error);
        return;
      }

      res.clearCookie("nzuri.sid");
      res.status(200).json({ success: true });
    });
  });

  router.post("/setup", async (req, res, next) => {
    const body = req.body || {};
    const setupKey = getSetupKey();
    const suppliedKey = typeof body.setupKey === "string" ? body.setupKey : "";

    if (!setupKey) {
      res.status(404).json({
        success: false,
        message: "Initial administrator setup is unavailable."
      });
      return;
    }

    const expected = Buffer.from(setupKey);
    const supplied = Buffer.from(suppliedKey);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      res.status(403).json({
        success: false,
        message: "The one-time setup key is invalid."
      });
      return;
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
    const password = typeof body.password === "string" ? body.password : "";
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (
      name.length < 2 ||
      name.length > 100 ||
      !validEmail ||
      email.length > 254 ||
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      res.status(400).json({
        success: false,
        message: "Enter a name, valid email, and a password between 12 and 72 bytes."
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await pool.connect();

    try {
      await connection.query("BEGIN");
      const setupResult = await connection.query(
        "SELECT completed FROM admin_setup WHERE setup_id = 1 FOR UPDATE"
      );
      const adminResult = await connection.query(
        "SELECT COUNT(*) AS admin_count FROM admins"
      );

      if (
        !setupResult.rows[0] ||
        setupResult.rows[0].completed ||
        Number(adminResult.rows[0].admin_count) > 0
      ) {
        await connection.query("ROLLBACK");
        res.status(409).json({
          success: false,
          message: "Initial administrator setup has already been completed."
        });
        return;
      }

      await connection.query(
        "INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)",
        [name, email, passwordHash]
      );
      await connection.query(
        "UPDATE admin_setup SET completed = TRUE WHERE setup_id = 1"
      );
      await connection.query("COMMIT");

      res.status(201).json({ success: true });
    } catch (error) {
      await connection.query("ROLLBACK");
      if (error.code === "23505") {
        res.status(409).json({
          success: false,
          message: "An administrator with that email already exists."
        });
        return;
      }
      next(error);
    } finally {
      connection.release();
    }
  });

  return router;
};

module.exports = createAuthRouter;
