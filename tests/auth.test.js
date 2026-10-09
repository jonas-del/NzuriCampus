"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const createAuthRouter = require("../routes/auth");
const createAdminRouter = require("../routes/admin");

const admins = [];
let setupCompleted = false;
const summary = {
  total_venues: "0",
  available_venues: "0",
  occupied_venues: "0",
  pending_bookings: "0",
  approved_bookings: "0",
  rejected_bookings: "0",
  total_bookings: "0"
};

const pool = {
  async query(sql, values) {
    if (sql.includes("SELECT id, name, email, password_hash FROM admins")) {
      return { rows: admins.filter(admin => admin.email === values[0]) };
    }
    if (sql.includes("COUNT(*) FROM venues")) {
      return { rows: [summary] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async connect() {
    let pendingAdmin = null;
    let pendingSetupCompleted = setupCompleted;

    return {
      async query(sql, values) {
        if (sql === "BEGIN") return { rows: [] };
        if (sql === "COMMIT") {
          if (pendingAdmin) admins.push(pendingAdmin);
          setupCompleted = pendingSetupCompleted;
          return { rows: [] };
        }
        if (sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("SELECT completed FROM admin_setup")) {
          return { rows: [{ completed: setupCompleted }] };
        }
        if (sql.includes("SELECT COUNT(*) AS admin_count")) {
          return { rows: [{ admin_count: String(admins.length) }] };
        }
        if (sql.includes("INSERT INTO admins")) {
          pendingAdmin = {
            id: "1",
            name: values[0],
            email: values[1],
            password_hash: values[2]
          };
          return { rows: [] };
        }
        if (sql.includes("UPDATE admin_setup")) {
          pendingSetupCompleted = true;
          return { rows: [] };
        }
        throw new Error(`Unexpected transaction query: ${sql}`);
      },
      release() {}
    };
  }
};

const app = express();
app.use(express.json());
app.use(session({
  secret: "test-session-secret-is-at-least-32-bytes-long",
  resave: false,
  saveUninitialized: false
}));
app.use("/api/auth", createAuthRouter({
  pool,
  getSetupKey: () => "one-time-test-key"
}));
app.use("/api/admin", createAdminRouter(pool));

let server;
let baseUrl;

before(async () => {
  server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

const post = (route, body, cookie) => fetch(`${baseUrl}${route}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {})
  },
  body: JSON.stringify(body)
});

test("first-admin setup, login, protected summary, and logout", async () => {
  let response = await fetch(`${baseUrl}/api/admin/summary`);
  assert.equal(response.status, 401);

  response = await post("/api/auth/setup", {
    setupKey: "incorrect-key",
    name: "Test Admin",
    email: "admin@example.test",
    password: "a-strong-test-password"
  });
  assert.equal(response.status, 403);

  response = await post("/api/auth/setup", {
    setupKey: "one-time-test-key",
    name: "Test Admin",
    email: "admin@example.test",
    password: "a-strong-test-password"
  });
  assert.equal(response.status, 201);
  assert.notEqual(admins[0].password_hash, "a-strong-test-password");
  assert.equal(
    await bcrypt.compare("a-strong-test-password", admins[0].password_hash),
    true
  );

  response = await post("/api/auth/setup", {
    setupKey: "one-time-test-key",
    name: "Second Admin",
    email: "second@example.test",
    password: "another-strong-password"
  });
  assert.equal(response.status, 409);

  response = await post("/api/auth/login", {
    email: "admin@example.test",
    password: "incorrect-password"
  });
  assert.equal(response.status, 401);

  response = await post("/api/auth/login", {
    email: "ADMIN@example.test",
    password: "a-strong-test-password"
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  const cookie = setCookie.split(";")[0];

  response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/admin/summary`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).summary.totalVenues, 0);

  response = await post("/api/auth/logout", {}, cookie);
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 401);
});
