"use strict";

const form = document.querySelector("#login-form");
const message = document.querySelector("#form-message");
const submitButton = form.querySelector('button[type="submit"]');
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector(".password-toggle");

const showMessage = text => {
  message.textContent = text;
  message.hidden = false;
};

fetch("/api/auth/me", { headers: { Accept: "application/json" } })
  .then(response => {
    if (response.ok) {
      window.location.replace("/admin/dashboard");
    }
  })
  .catch(() => {
    showMessage("Unable to reach the sign-in service. Please try again.");
  });

passwordToggle.addEventListener("click", () => {
  const showPassword = passwordInput.type === "password";
  passwordInput.type = showPassword ? "text" : "password";
  passwordToggle.textContent = showPassword ? "Hide" : "Show";
  passwordToggle.setAttribute("aria-pressed", String(showPassword));
  passwordToggle.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  message.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = "Signing in...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        remember: form.elements["remember-me"].checked
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to sign in. Check your details and try again.");
    }

    window.location.replace("/admin/dashboard");
  } catch (error) {
    showMessage(error.message || "Unable to reach the sign-in service. Please try again.");
    submitButton.disabled = false;
    submitButton.textContent = "Sign in";
  }
});
