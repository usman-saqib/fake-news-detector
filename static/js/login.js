// ===========================================================
// LOGIN / SIGNUP PAGE LOGIC
// ===========================================================

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    document.querySelectorAll(".auth-form").forEach(f => f.classList.add("hidden"));
    document.getElementById(tab.getAttribute("data-form")).classList.remove("hidden");
  });
});

function togglePassword(inputId, eyeEl) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    eyeEl.innerText = "🙈";
  } else {
    input.type = "password";
    eyeEl.innerText = "👁️";
  }
}

// ---------------- LIGHT / DARK THEME TOGGLE ----------------
function setTheme(theme, btnEl) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("fnd-theme", theme);

  document.querySelectorAll(".theme-btn").forEach(b => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
}

// Apply saved theme on page load (defaults to dark if none saved)
(function initTheme() {
  const savedTheme = localStorage.getItem("fnd-theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-theme") === savedTheme);
  });
})();