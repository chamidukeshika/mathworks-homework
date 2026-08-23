const el = id => document.getElementById(id);

function toast(message) {
  const t = el("toast");
  t.textContent = message;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

(async function redirectIfLoggedIn() {
  const res = await fetch("/api/auth/me").catch(() => null);
  if (res && res.ok) {
    const user = await res.json();
    location.href = user.role === "teacher" ? "/teacher" : "/student";
  }
})();

el("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = el("usernameInput").value.trim();
  const password = el("passwordInput").value;
  if (!username || !password) return toast("Enter your username and password.");

  const btn = el("submitBtn");
  btn.disabled = true;
  btn.textContent = "Logging in...";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Something went wrong.");

    location.href = data.role === "teacher" ? "/teacher" : "/student";
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = "Log in →";
  }
});
