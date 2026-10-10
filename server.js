"use strict";

require("dotenv").config();

const path = require("node:path");
const express = require("express");
const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const { Pool } = require("pg");
const createAuthRouter = require("./routes/auth");
const createAdminRouter = require("./routes/admin");
const { createPublicRouter } = createAdminRouter;

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const hasSessionSecret =
  Buffer.byteLength(process.env.SESSION_SECRET || "", "utf8") >= 32;
const authConfigured = hasDatabaseUrl && hasSessionSecret;
const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000
    })
  : null;

if (pool) {
  pool.on("error", error => {
    console.error("PostgreSQL pool error:", error.message);
  });
}

const sessionStore = authConfigured
  ? new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: false,
      pruneSessionInterval: false
    })
  : null;
const app = express();
const publicDirectory = path.join(__dirname, "public");

app.disable("x-powered-by");
app.set("trust proxy", process.env.VERCEL === "1" ? 1 : false);

const contentSecurityPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"]
};
if (process.env.NODE_ENV === "production") {
  contentSecurityPolicy["upgrade-insecure-requests"] = [];
}
app.use(helmet({
  contentSecurityPolicy: { directives: contentSecurityPolicy }
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(publicDirectory, {
  dotfiles: "deny",
  index: false
}));
if (authConfigured) {
  app.use(session({
    name: "nzuri.sid",
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: null
    }
  }));
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please wait and try again." }
});
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many setup attempts. Please wait and try again." }
});

app.get("/", (req, res) => res.sendFile(path.join(publicDirectory, "index.html")));
app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(publicDirectory, "admin-login.html"));
});
app.get("/admin/setup", (req, res) => {
  if (!authConfigured || !process.env.ADMIN_SETUP_KEY) {
    res.redirect("/admin/login");
    return;
  }
  res.sendFile(path.join(publicDirectory, "admin-setup.html"));
});
app.get("/admin/dashboard", (req, res) => {
  if (!req.session || !req.session.adminId) {
    res.redirect("/admin/login");
    return;
  }
  res.sendFile(path.join(publicDirectory, "admin-dashboard.html"));
});

app.get("/api/health", async (req, res, next) => {
  if (!authConfigured) {
    res.status(503).json({
      success: false,
      status: "configuration_required",
      message: "Add DATABASE_URL and SESSION_SECRET to the deployment environment."
    });
    return;
  }

  try {
    await pool.query("SELECT 1");
    res.status(200).json({ success: true, status: "online" });
  } catch (error) {
    next(error);
  }
});

if (authConfigured) {
  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth/setup", setupLimiter);
  app.use("/api/auth", createAuthRouter({
    pool,
    getSetupKey: () => process.env.ADMIN_SETUP_KEY || ""
  }));
} else {
  app.use("/api/auth", (req, res) => {
    res.status(503).json({
      success: false,
      configured: false,
      message: "Admin sign-in is unavailable until DATABASE_URL and SESSION_SECRET are configured."
    });
  });
}
app.use("/api", createPublicRouter(pool));
if (authConfigured) {
  app.use("/api/admin", createAdminRouter(pool));
} else {
  app.use("/api/admin", (req, res) => {
    res.status(503).json({
      success: false,
      configured: false,
      message: "Admin services are unavailable until DATABASE_URL and SESSION_SECRET are configured."
    });
  });
}

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: "API route not found." });
});
app.use((req, res) => {
  res.status(404).type("text").send("Page not found.");
});
app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  console.error("Request failed:", error);
  if (req.path.startsWith("/api/")) {
    res.status(500).json({
      success: false,
      message: "The request could not be completed. Check the server logs for details."
    });
    return;
  }
  res.status(500).type("text").send("The page could not be loaded.");
});

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "127.0.0.1", () => {
    console.log(`Nzuri Venue Management is running at http://127.0.0.1:${port}`);
    if (!authConfigured) {
      console.warn("Admin sign-in is disabled until DATABASE_URL and SESSION_SECRET are configured.");
    }
  });
}
