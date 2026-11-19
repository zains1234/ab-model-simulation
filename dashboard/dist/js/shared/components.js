(function () {
  "use strict";
  window.AppComponentsReady = fetch("/components/header.html")
    .then(function (response) {
      if (!response.ok) throw new Error("Unable to load shared header");
      return response.text();
    })
    .then(function (markup) {
      var host = document.getElementById("shared_header");
      if (host) host.innerHTML = markup;
    })
    .catch(function (error) {
      console.error("Shared component loading failed:", error);
    });
})();