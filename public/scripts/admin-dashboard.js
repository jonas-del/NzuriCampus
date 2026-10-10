"use strict";

const dashboardMessage = document.querySelector("#dashboard-message");
const venueForm = document.querySelector("#venue-form");
const venueFormMessage = document.querySelector("#venue-form-message");
const venueList = document.querySelector("#venue-list");
const bookingList = document.querySelector("#booking-list");
const logoutButton = document.querySelector("#logout-button");

const showDashboardMessage = text => {
  dashboardMessage.textContent = text;
  dashboardMessage.hidden = false;
};

const setValue = (id, value) => {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = String(value);
  }
};

const setFormMessage = (element, text, isError = false) => {
  element.textContent = text;
  element.hidden = false;
  element.style.color = isError ? "#8f2118" : "#174b48";
  element.style.background = isError ? "#fff6f5" : "#edf7f1";
  element.style.borderColor = isError ? "#f2c6c2" : "#cfe9d7";
};

const renderVenueList = venues => {
  if (!venueList) return;
  if (!venues.length) {
    venueList.innerHTML = '<p class="empty-state">No venues yet. Add the first room to get started.</p>';
    return;
  }

  venueList.innerHTML = venues.map(venue => `
    <article class="venue-item ${venue.isActive ? "" : "inactive"}">
      <div>
        <h4>${escapeHtml(venue.name)}</h4>
        <p>${escapeHtml(venue.building || "No building recorded")}</p>
      </div>
      <div class="venue-meta">
        <span>${venue.capacity} seats</span>
        <span class="badge ${venue.isActive ? "active" : "inactive"}">${venue.isActive ? "Active" : "Inactive"}</span>
      </div>
      <div class="venue-actions">
        <button type="button" class="secondary-button" data-venue-toggle="${venue.id}" data-venue-state="${venue.isActive ? "false" : "true"}">
          ${venue.isActive ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  `).join("");
};

const renderBookingList = bookings => {
  if (!bookingList) return;
  if (!bookings.length) {
    bookingList.innerHTML = '<p class="empty-state">There are no booking requests right now.</p>';
    return;
  }

  bookingList.innerHTML = bookings.map(booking => `
    <article class="booking-item">
      <div class="booking-header">
        <div>
          <h4>${escapeHtml(booking.eventTitle || "Untitled event")}</h4>
          <p>${escapeHtml(booking.venueName || "Unknown venue")}</p>
        </div>
        <span class="status-badge status-${booking.status}">${booking.status}</span>
      </div>
      <dl class="booking-details">
        <div><dt>Requester</dt><dd>${escapeHtml(booking.requesterEmail)}</dd></div>
        <div><dt>Time</dt><dd>${formatDateTime(booking.startsAt)} → ${formatDateTime(booking.endsAt)}</dd></div>
        <div><dt>Building</dt><dd>${escapeHtml(booking.venueBuilding || "Not recorded")}</dd></div>
      </dl>
      <div class="booking-actions">
        ${booking.status === "pending" ? `
          <button type="button" class="approve-button" data-booking-status="${booking.id}" data-status="approved">Approve</button>
          <button type="button" class="reject-button" data-booking-status="${booking.id}" data-status="rejected">Reject</button>
        ` : ""}
      </div>
    </article>
  `).join("");
};

const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

const formatDateTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const loadDashboard = async () => {
  try {
    const [sessionResponse, summaryResponse, venuesResponse, bookingsResponse] = await Promise.all([
      fetch("/api/auth/me", { headers: { Accept: "application/json" } }),
      fetch("/api/admin/summary", { headers: { Accept: "application/json" } }),
      fetch("/api/admin/venues", { headers: { Accept: "application/json" } }),
      fetch("/api/admin/bookings", { headers: { Accept: "application/json" } })
    ]);

    if (sessionResponse.status === 401 || summaryResponse.status === 401) {
      window.location.replace("/admin/login");
      return;
    }

    const sessionData = await sessionResponse.json();
    const summaryData = await summaryResponse.json();
    const venuesData = await venuesResponse.json();
    const bookingsData = await bookingsResponse.json();

    if (!sessionResponse.ok || !summaryResponse.ok) {
      throw new Error(summaryData.message || sessionData.message || "Unable to load dashboard data.");
    }

    if (!venuesResponse.ok) {
      throw new Error(venuesData.message || "Unable to load venues.");
    }

    if (!bookingsResponse.ok) {
      throw new Error(bookingsData.message || "Unable to load booking requests.");
    }

    document.querySelector("#admin-name").textContent = sessionData.admin.name;
    const summary = summaryData.summary;
    setValue("total-venues", summary.totalVenues);
    setValue("available-venues", summary.availableVenues);
    setValue("occupied-venues", summary.occupiedVenues);
    setValue("pending-bookings", summary.pendingBookings);
    setValue("approved-bookings", summary.approvedBookings);
    setValue("total-bookings", summary.totalBookings);
    setValue("overview-pending", summary.pendingBookings);
    setValue("overview-approved", summary.approvedBookings);
    setValue("rejected-bookings", summary.rejectedBookings);
    const visibleBookings = (bookingsData.bookings || []).sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return new Date(b.startsAt) - new Date(a.startsAt);
    });
    renderVenueList(venuesData.venues || []);
    renderBookingList(visibleBookings);
  } catch (error) {
    showDashboardMessage(error.message || "Unable to load dashboard data. Please refresh to try again.");
  }
};

const createVenue = async event => {
  event.preventDefault();
  const formData = new FormData(venueForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    building: String(formData.get("building") || "").trim(),
    capacity: Number(formData.get("capacity") || 0),
    isActive: formData.get("isActive") === "on"
  };

  if (!payload.name || !Number.isInteger(payload.capacity) || payload.capacity < 0) {
    setFormMessage(venueFormMessage, "Enter a valid venue name and a non-negative capacity.", true);
    return;
  }

  try {
    const response = await fetch("/api/admin/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to create the venue.");
    }

    venueForm.reset();
    document.querySelector("#venue-active").checked = true;
    setFormMessage(venueFormMessage, "Venue added successfully.", false);
    await loadDashboard();
  } catch (error) {
    setFormMessage(venueFormMessage, error.message || "Unable to create the venue.", true);
  }
};

const toggleVenue = async (venueId, nextState) => {
  try {
    const response = await fetch(`/api/admin/venues/${venueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ isActive: nextState })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to update the venue.");
    }

    await loadDashboard();
  } catch (error) {
    showDashboardMessage(error.message || "Unable to update the venue.");
  }
};

const updateBookingStatus = async (bookingId, status) => {
  try {
    const response = await fetch(`/api/admin/bookings/${bookingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ status })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to update the booking.");
    }

    await loadDashboard();
  } catch (error) {
    showDashboardMessage(error.message || "Unable to update the booking status.");
  }
};

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = "Signing out...";

  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Unable to sign out.");
    }

    window.location.replace("/admin/login");
  } catch (error) {
    showDashboardMessage(error.message || "Unable to sign out. Please try again.");
    logoutButton.disabled = false;
    logoutButton.textContent = "Logout";
  }
});

venueForm.addEventListener("submit", createVenue);
venueList.addEventListener("click", event => {
  const toggleButton = event.target.closest("[data-venue-toggle]");
  if (!toggleButton) return;
  const venueId = Number(toggleButton.dataset.venueToggle);
  const nextState = toggleButton.dataset.venueState === "true";
  if (Number.isInteger(venueId)) {
    toggleVenue(venueId, nextState);
  }
});
bookingList.addEventListener("click", event => {
  const button = event.target.closest("[data-booking-status]");
  if (!button) return;
  const bookingId = Number(button.dataset.bookingStatus);
  const status = button.dataset.status;
  if (Number.isInteger(bookingId) && (status === "approved" || status === "rejected")) {
    updateBookingStatus(bookingId, status);
  }
});

loadDashboard();
