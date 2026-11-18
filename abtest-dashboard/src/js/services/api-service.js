(function () {
  "use strict";
  async function request(url, options) {
    var response = await fetch(url, Object.assign({
      headers: { "Content-Type": "application/json" }
    }, options || {}));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(payload.error || ("Request failed (" + response.status + ")"));
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  window.ApiService = {
    list: function () { return request("/api/experiments"); },
    get: function (id) { return request("/api/experiments/" + encodeURIComponent(id)); },
    create: function (data) { return request("/api/experiments", { method: "POST", body: JSON.stringify(data) }); },
    update: function (id, data) { return request("/api/experiments/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(data) }); },
    remove: function (id) { return request("/api/experiments/" + encodeURIComponent(id), { method: "DELETE" }); },
    validate: function (data) { return request("/api/experiments/" + encodeURIComponent(data.id) + "/validate", { method: "POST", body: JSON.stringify(data) }); }
  };
})();