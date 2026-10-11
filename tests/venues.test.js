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

    if (text.includes("AS total_venues") && text.includes("AS building_count")) {
      const activeVenues = venues.filter(venue => venue.is_active === true);
      const now = Date.now();
      const occupiedVenueIds = new Set(bookings
        .filter(booking => booking.status === "approved"
          && new Date(booking.starts_at).getTime() <= now
          && new Date(booking.ends_at).getTime() > now)
        .map(booking => booking.venue_id));
      const isWeekend = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Nairobi", weekday: "short" })
        .format(new Date()) === "Sat"
        || new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Nairobi", weekday: "short" })
          .format(new Date()) === "Sun";
      return { rows: [{
        total_venues: String(activeVenues.length),
        available_venues: String(activeVenues.length - (isWeekend ? 0 : occupiedVenueIds.size)),
        occupied_venues: String(isWeekend ? 0 : occupiedVenueIds.size),
        pending_bookings: String(bookings.filter(booking => booking.status === "pending").length),
        approved_bookings: String(bookings.filter(booking => booking.status === "approved").length),
        rejected_bookings: String(bookings.filter(booking => booking.status === "rejected").length),
        total_bookings: String(bookings.length),
        building_count: String(new Set(activeVenues.map(venue => venue.building.trim()).filter(Boolean)).size),
        average_capacity: String(Math.round(activeVenues.reduce((sum, venue) => sum + venue.capacity, 0) / (activeVenues.length || 1)))
      }] };
    }

    if (text.startsWith("SELECT id, name, building, capacity, is_active, created_at")) {
      return { rows: venues.filter(venue => venue.is_active === true) };
    }

    if (text.includes("LEFT JOIN bookings b") && text.startsWith("SELECT v.id, v.name, v.building, v.capacity, v.is_active, v.created_at")) {
      return { rows: venues.filter(venue => venue.capacity >= Number(values[2]) && (values[3] || !bookings.some(booking => booking.venue_id === venue.id && booking.status === "approved" && new Date(booking.starts_at) < new Date(values[1]) && new Date(booking.ends_at) > new Date(values[0])))) };
    }

    if (text.startsWith("SELECT v.id, v.name, v.building, v.capacity, v.is_active, v.created_at,")) {
      return { rows: venues.filter(venue => venue.is_active).map(venue => {
        const isAvailable = values[2] || !bookings.some(booking => booking.venue_id === venue.id
          && booking.status === "approved"
          && new Date(booking.starts_at) < new Date(values[1])
          && new Date(booking.ends_at) > new Date(values[0]));
        const isInUse = !values[3] && bookings.some(booking => booking.venue_id === venue.id
          && booking.status === "approved"
          && new Date(booking.starts_at) <= Date.now()
          && new Date(booking.ends_at) > Date.now());
        return { ...venue, is_available: isAvailable, is_in_use: isInUse };
      }) };
    }

    if (text.includes("id <> $2") && text.startsWith("SELECT id FROM bookings")) {
      return { rows: bookings.filter(booking => booking.venue_id === Number(values[0])
        && booking.id !== Number(values[1])
        && booking.status === "approved"
        && new Date(booking.starts_at) < new Date(values[3])
        && new Date(booking.ends_at) > new Date(values[2]))
        .slice(0, 1) };
    }

    if (text.startsWith("SELECT id, venue_id, starts_at, ends_at FROM bookings")) {
      return { rows: bookings.filter(booking => booking.id === Number(values[0])).map(booking => ({
        id: booking.id,
        venue_id: booking.venue_id,
        starts_at: booking.starts_at,
        ends_at: booking.ends_at
      })) };
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
      return { rows: [...bookings].sort((left, right) => new Date(right.starts_at) - new Date(left.starts_at)).map(booking => ({
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

  response = await fetch(`${baseUrl}/api/venues/summary`);
  assert.equal(response.status, 200);
  const summary = (await response.json()).summary;
  assert.equal(summary.totalVenues, 2);
  assert.equal(summary.buildingCount, 2);
  assert.equal(summary.averageCapacity, 78);
});

test("weekend availability and booking requests ignore approved bookings", async () => {
  bookings.push({
    id: 900,
    venue_id: 1,
    starts_at: "2026-02-07T09:00:00.000Z",
    ends_at: "2026-02-07T12:00:00.000Z",
    status: "approved"
  }, {
    id: 901,
    venue_id: 2,
    starts_at: "2026-02-08T09:00:00.000Z",
    ends_at: "2026-02-08T12:00:00.000Z",
    status: "approved"
  });
  let response = await fetch(`${baseUrl}/api/venues/availability?startsAt=2026-02-07T10:00:00Z&endsAt=2026-02-07T11:00:00Z&capacity=20`);
  assert.equal(response.status, 200);
  const availability = await response.json();
  assert.equal(availability.available.length, 2);

  response = await fetch(`${baseUrl}/api/venues/availability?startsAt=2026-02-08T10:00:00Z&endsAt=2026-02-08T11:00:00Z&capacity=20`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).available.length, 2);

  response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venueId: 1,
      requesterEmail: "weekend@example.test",
      eventTitle: "Weekend activity",
      startsAt: "2026-02-07T10:00:00Z",
      endsAt: "2026-02-07T11:00:00Z"
    })
  });
  assert.equal(response.status, 201);
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
  const bookingToApprove = bookingList.bookings.find(booking => booking.venueId === 2
    && new Date(booking.startsAt).toISOString() === "2026-02-02T10:00:00.000Z");
  assert.ok(bookingToApprove);

  response = await fetch(`${baseUrl}/api/admin/bookings/${bookingToApprove.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved" })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).booking.status, "approved");

  response = await fetch(`${baseUrl}/api/admin/availability?startsAt=2026-02-02T10:00:00Z&endsAt=2026-02-02T12:00:00Z`);
  assert.equal(response.status, 200);
  const availability = await response.json();
  assert.equal(availability.venues.length, 2);
  assert.equal(availability.venues.find(venue => venue.id === 2).isAvailable, false);
});

test("admin cannot approve overlapping weekday bookings", async () => {
  const bookingRequest = {
    venueId: 1,
    requesterEmail: "student@example.test",
    eventTitle: "Lecture",
    startsAt: "2026-03-02T10:00:00Z",
    endsAt: "2026-03-02T11:00:00Z"
  };
  const firstResponse = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookingRequest)
  });
  const firstBooking = (await firstResponse.json()).booking;
  const secondResponse = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookingRequest)
  });
  const secondBooking = (await secondResponse.json()).booking;

  const approve = id => fetch(`${baseUrl}/api/admin/bookings/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved" })
  });
  assert.equal((await approve(firstBooking.id)).status, 200);
  const rejectedConflict = await approve(secondBooking.id);
  assert.equal(rejectedConflict.status, 409);
});
