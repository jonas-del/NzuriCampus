"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const express = require("express");
const session = require("express-session");
const createAdminRouter = require("../routes/admin");
const { createPublicRouter } = require("../routes/admin");

const venues = [
  { id: 1, name: "Main Hall", building: "Science Block", capacity: 120, is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: 2, name: "Seminar Room", building: "Engineering Block", capacity: 35, is_active: true, created_at: "2026-01-02T00:00:00.000Z" }
];
const bookings = [];

const pool = {
  async query(sql, values = []) {
    const text = String(sql).trim();

    if (text.startsWith("SELECT id, name, building, capacity, is_active, created_at")) {
      return { rows: venues.filter(venue => venue.is_active === true) };
    }

    if (text.startsWith("SELECT v.id, v.name, v.building, v.capacity, v.is_active, v.created_at")) {
      return { rows: venues.filter(venue => venue.capacity >= Number(values[2]) && !bookings.some(booking => booking.venue_id === venue.id && booking.status === "approved" && new Date(booking.starts_at) < new Date(values[1]) && new Date(booking.ends_at) > new Date(values[0]))) };
    }

    if (text.includes("INSERT INTO bookings")) {
      const created = {
        id: bookings.length + 1,
        venue_id: Number(values[0]),
        requester_email: values[1],
        event_title: values[2],
        starts_at: values[3],
        ends_at: values[4],
        status: values[5] || "pending",
        created_at: "2026-02-01T00:00:00.000Z"
      };
      bookings.push(created);
      return { rows: [created] };
    }

    if (text.includes("SELECT id, name, building, capacity, is_active FROM venues WHERE id =")) {
      const venue = venues.find(item => item.id === Number(values[0]));
      return { rows: venue && venue.is_active ? [venue] : [] };
    }

    if (text.startsWith("UPDATE bookings")) {
      const booking = bookings.find(item => item.id === Number(values[1]));
      if (!booking) return { rows: [] };
      booking.status = values[0];
      return { rows: [booking] };
    }

    if (text.startsWith("SELECT b.id, b.venue_id")) {
      return { rows: bookings.map(booking => ({
        ...booking,
        venue_name: venues.find(venue => venue.id === booking.venue_id)?.name || "",
        venue_building: venues.find(venue => venue.id === booking.venue_id)?.building || ""
      })) };
    }

    if (text.startsWith("INSERT INTO venues")) {
      const nextId = venues.reduce((max, venue) => Math.max(max, venue.id), 0) + 1;
      const created = {
        id: nextId,
        name: values[0],
        building: values[1],
        capacity: Number(values[2]),
        is_active: values[3],
        created_at: "2026-02-05T00:00:00.000Z"
      };
      venues.push(created);
      return { rows: [created] };
    }

    if (text.startsWith("UPDATE venues")) {
      const venue = venues.find(item => item.id === Number(values[values.length - 1]));
      if (!venue) return { rows: [] };
      if (text.includes("is_active =")) {
        venue.is_active = values[0];
      }
      return { rows: [venue] };
    }

    if (text.startsWith("SELECT id, name, building, capacity, is_active FROM venues WHERE id = $1 AND is_active = TRUE")) {
      const venue = venues.find(item => item.id === Number(values[0]));
      return { rows: venue && venue.is_active ? [venue] : [] };
    }

    return { rows: [] };
  }
};

const app = express();
app.use(express.json());
app.use(session({ secret: "test-session-secret-is-at-least-32-bytes-long", resave: false, saveUninitialized: false }));
app.use((req, res, next) => {
  req.session = req.session || {};
  req.session.adminId = 1;
  req.session.adminName = "Test Admin";
  req.session.adminEmail = "admin@example.test";
  next();
});
app.use("/api", createPublicRouter(pool));
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

test("public venue listing and booking request work", async () => {
  let response = await fetch(`${baseUrl}/api/venues`);
  assert.equal(response.status, 200);
  const venuesPayload = await response.json();
  assert.equal(venuesPayload.venues.length, 2);

  response = await fetch(`${baseUrl}/api/venues/availability?startsAt=2026-02-01T10:00:00Z&endsAt=2026-02-01T12:00:00Z&capacity=30`);
  assert.equal(response.status, 200);
  const availability = await response.json();
  assert.equal(availability.available.length, 2);

  response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venueId: 2,
      requesterEmail: "student@example.test",
      eventTitle: "Study group",
      startsAt: "2026-02-01T10:00:00Z",
      endsAt: "2026-02-01T12:00:00Z"
    })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).booking.status, "pending");
});

test("admin can list venues and change booking status", async () => {
  let response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venueId: 2,
      requesterEmail: "student@example.test",
      eventTitle: "Study group",
      startsAt: "2026-02-02T10:00:00Z",
      endsAt: "2026-02-02T12:00:00Z"
    })
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/api/admin/venues`);
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.equal(list.venues.length >= 2, true);

  response = await fetch(`${baseUrl}/api/admin/bookings`);
  assert.equal(response.status, 200);
  const bookingList = await response.json();
  assert.equal(bookingList.bookings.length >= 1, true);

  response = await fetch(`${baseUrl}/api/admin/bookings/${bookingList.bookings[0].id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved" })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).booking.status, "approved");
});
