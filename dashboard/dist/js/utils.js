(function () {
  "use strict";
  window.cloneData = function (value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  };
  window.stableStringify = function (value) {
    if (Array.isArray(value)) return "[" + value.map(window.stableStringify).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + window.stableStringify(value[k])).join(",") + "}";
    }
    return JSON.stringify(value);
  };
  window.notify = function (message, type) {
    var el = document.getElementById("app_notification");
    if (!el) return;
    el.textContent = message;
    el.className = "app-notification " + (type || "success");
    window.clearTimeout(window.__notificationTimer);
    window.__notificationTimer = window.setTimeout(function () { el.classList.add("hidden"); }, 3500);
  };
  window.getRouteName = function () {
    var parts = location.pathname.split("/").filter(Boolean);
    return parts.length > 1 ? decodeURIComponent(parts[1]) : "";
  };
  window.getRouteId = window.getRouteName;
})();