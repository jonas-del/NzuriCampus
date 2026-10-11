"use strict";

const availabilityForm = document.querySelector("#availability-form");
const availabilityResults = document.querySelector("#availability-results");
const availabilityMessage = document.querySelector("#availability-message");
const bookingForm = document.querySelector("#booking-form");
const bookingMessage = document.querySelector("#booking-message");
const summaryMessage = document.querySelector("#public-summary-message");

const loadPublicSummary = async () => {
  try {
    const response = await fetch("/api/venues/summary", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Unable to load live campus statistics.");
    }

    if (data.configured === false || !data.summary) {
      summaryMessage.textContent = "Live campus statistics are unavailable until the venue database is connected.";
      summaryMessage.hidden = false;
      return;
    }

    const summary = data.summary;
    document.querySelector("#public-total-venues").textContent = summary.totalVenues;
    document.querySelector("#public-available-venues").textContent = summary.availableVenues;
    document.querySelector("#public-occupied-venues").textContent = summary.occupiedVenues;
    document.querySelector("#public-building-count").textContent = summary.buildingCount;
    document.querySelector("#public-average-capacity").textContent = summary.averageCapacity;
    document.querySelector("#public-pending-bookings").textContent = summary.pendingBookings;
    summaryMessage.hidden = true;
  } catch (error) {
    summaryMessage.textContent = error.message || "Unable to load live campus statistics.";
    summaryMessage.hidden = false;
  }
};

const formatDateTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const setStatusMessage = (element, text, isError = false) => {
  if (!element) return;
  element.textContent = text;
  element.hidden = false;
  element.style.color = isError ? "#8f2118" : "#174b48";
  element.style.background = isError ? "#fff6f5" : "#edf7f1";
  element.style.borderColor = isError ? "#f2c6c2" : "#cfe9d7";
};

const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

const populateDefaultSearch = () => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setHours(end.getHours() + 2);

  const dateTimeLocal = value => {
    const offset = value.getTimezoneOffset();
    const adjusted = new Date(value.getTime() - offset * 60000);
    return adjusted.toISOString().slice(0, 16);
  };

  const startsInput = document.querySelector("#starts-at");
  const endsInput = document.querySelector("#ends-at");
  if (startsInput) startsInput.value = dateTimeLocal(start);
  if (endsInput) endsInput.value = dateTimeLocal(end);
  const bookingStarts = document.querySelector("#booking-starts");
  const bookingEnds = document.querySelector("#booking-ends");
  if (bookingStarts) bookingStarts.value = startsInput.value;
  if (bookingEnds) bookingEnds.value = endsInput.value;
};

const renderAvailability = venues => {
  if (!availabilityResults) return;

  if (!venues.length) {
    availabilityResults.innerHTML = '<p class="empty-state">No rooms match your search. Try a different time or larger capacity.</p>';
    return;
  }

  availabilityResults.innerHTML = venues.map(venue => `
    <article class="venue-result">
      <div class="venue-result-header">
        <div>
          <h3>${escapeHtml(venue.name)}</h3>
          <p>${escapeHtml(venue.building || "Campus building not listed")}</p>
        </div>
        <span class="result-capacity">${venue.capacity} seats</span>
      </div>
      <div class="venue-result-actions">
        <button type="button" class="request-room-button" data-venue-id="${venue.id}" data-venue-name="${escapeHtml(venue.name)}" data-venue-building="${escapeHtml(venue.building || "")}">
          Request this room
        </button>
      </div>
    </article>
  `).join("");
};

const searchAvailability = async event => {
  event.preventDefault();
  const startsInput = document.querySelector("#starts-at");
  const endsInput = document.querySelector("#ends-at");
  const capacityInput = document.querySelector("#capacity");

  const startsAt = startsInput.value;
  const endsAt = endsInput.value;
  const capacity = Number(capacityInput.value || 0);

  if (!startsAt || !endsAt || !Number.isFinite(capacity) || capacity < 1) {
    setStatusMessage(availabilityMessage, "Enter a valid date range and group size.", true);
    return;
  }

  if (new Date(endsAt) <= new Date(startsAt)) {
    setStatusMessage(availabilityMessage, "The end time must be later than the start time.", true);
    return;
  }

  try {
    const query = new URLSearchParams({
      startsAt,
      endsAt,
      capacity: String(capacity)
    });

    const response = await fetch(`/api/venues/availability?${query.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to find available rooms.");
    }

    if (data.configured === false) {
      renderAvailability([]);
      setStatusMessage(availabilityMessage, data.message || "The venue directory will appear after the site is connected to its database.", true);
      return;
    }

    renderAvailability(data.available || []);
    setStatusMessage(availabilityMessage, `${(data.available || []).length} room${(data.available || []).length === 1 ? "" : "s"} available.`, false);
  } catch (error) {
    setStatusMessage(availabilityMessage, error.message || "Unable to search for room availability.", true);
    availabilityResults.innerHTML = "";
  }
};

const selectVenue = event => {
  const button = event.target.closest("[data-venue-id]");
  if (!button) return;

  const venueId = Number(button.dataset.venueId);
  const selectedName = button.dataset.venueName || "Selected venue";
  const selectedBuilding = button.dataset.venueBuilding || "";

  const venueInput = document.querySelector("#booking-venue");
  const venueIdInput = document.querySelector("#booking-venue-id");
  const bookingStarts = document.querySelector("#booking-starts");
  const bookingEnds = document.querySelector("#booking-ends");
  const startsAt = document.querySelector("#starts-at").value;
  const endsAt = document.querySelector("#ends-at").value;

  if (venueInput) venueInput.value = `${selectedName}${selectedBuilding ? `, ${selectedBuilding}` : ""}`;
  if (venueIdInput) venueIdInput.value = String(venueId);
  if (bookingStarts) bookingStarts.value = startsAt;
  if (bookingEnds) bookingEnds.value = endsAt;

  document.querySelector("#booking-request").scrollIntoView({ behavior: "smooth", block: "start" });
};

const submitBooking = async event => {
  event.preventDefault();

  const venueId = document.querySelector("#booking-venue-id").value;
  const eventTitle = document.querySelector("#event-title").value.trim();
  const requesterEmail = document.querySelector("#requester-email").value.trim();
  const startsAt = document.querySelector("#booking-starts").value;
  const endsAt = document.querySelector("#booking-ends").value;

  if (!venueId || !eventTitle || !requesterEmail || !startsAt || !endsAt) {
    setStatusMessage(bookingMessage, "Select a room and complete all booking details.", true);
    return;
  }

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        venueId: Number(venueId),
        eventTitle,
        requesterEmail,
        startsAt,
        endsAt
      })
    });
    const data = await response.json();

    if (!response.ok) {
      if (data.configured === false) {
        throw new Error(data.message || "Booking requests are unavailable until the site is connected to its database.");
      }
      throw new Error(data.message || "Unable to request the booking.");
    }

    bookingForm.reset();
    document.querySelector("#booking-venue").value = "Select a room from the availability search above";
    document.querySelector("#booking-venue-id").value = "";
    populateDefaultSearch();
    setStatusMessage(bookingMessage, "Booking request sent successfully. An administrator will review it soon.", false);
    availabilityForm.dispatchEvent(new Event("submit"));
  } catch (error) {
    setStatusMessage(bookingMessage, error.message || "Unable to submit the booking request.", true);
  }
};

availabilityForm.addEventListener("submit", searchAvailability);
availabilityResults.addEventListener("click", selectVenue);
bookingForm.addEventListener("submit", submitBooking);
populateDefaultSearch();
availabilityForm.dispatchEvent(new Event("submit"));
loadPublicSummary();
window.setInterval(loadPublicSummary, 60000);
