"use strict";

const form = document.querySelector("#setup-form");
const message = document.querySelector("#form-message");
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async event => {
  event.preventDefault();
  message.hidden = true;

  const password = form.elements.password.value;
  if (password !== form.elements["password-confirmation"].value) {
    message.textContent = "The passwords do not match.";
    message.hidden = false;
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Creating administrator...";

  try {
    const response = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        setupKey: form.elements["setup-key"].value,
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        password
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to create the administrator.");
    }

    window.location.replace("/admin/login?setup=complete");
  } catch (error) {
    message.textContent = error.message || "Unable to reach the setup service.";
    message.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = "Create administrator";
  }
});
