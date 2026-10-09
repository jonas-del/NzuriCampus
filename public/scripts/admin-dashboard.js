"use strict";

const message = document.querySelector("#dashboard-message");
const logoutButton = document.querySelector("#logout-button");

const showMessage = text => {
  message.textContent = text;
  message.hidden = false;
};

const setValue = (id, value) => {
  document.getElementById(id).textContent = String(value);
};

const loadDashboard = async () => {
  try {
    const [sessionResponse, summaryResponse] = await Promise.all([
      fetch("/api/auth/me", { headers: { Accept: "application/json" } }),
      fetch("/api/admin/summary", { headers: { Accept: "application/json" } })
    ]);

    if (sessionResponse.status === 401 || summaryResponse.status === 401) {
      window.location.replace("/admin/login");
      return;
    }

    const sessionData = await sessionResponse.json();
    const summaryData = await summaryResponse.json();

    if (!sessionResponse.ok || !summaryResponse.ok) {
      throw new Error(summaryData.message || sessionData.message || "Unable to load dashboard data.");
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
  } catch (error) {
    showMessage(error.message || "Unable to load dashboard data. Please refresh to try again.");
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
    showMessage(error.message || "Unable to sign out. Please try again.");
    logoutButton.disabled = false;
    logoutButton.textContent = "Logout";
  }
});

loadDashboard();
