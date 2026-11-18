(function () {
  "use strict";
  async function boot() {
    var id = getRouteId();
    try {
      var result = await ApiService.get(id);
      var exp = migrateExperiment(result.experiment);
      experiments = [exp];
      document.getElementById("simulation_id").value = exp.id;
      document.getElementById("detail_title").textContent = exp.name;
      document.getElementById("breadcrumb_name").textContent = exp.name;
      document.getElementById("detail_status").textContent = exp.status[0].toUpperCase() + exp.status.slice(1);
      document.getElementById("detail_status").className = "status " + exp.status;
      document.getElementById("saved_version").textContent = "Saved configuration · v" + normalizeVersion(exp.version);
      document.getElementById("back_configuration_link").href = "/configuration/" + encodeURIComponent(exp.id);
      renderSimulationContext();
    } catch (error) {
      document.querySelector("main").innerHTML = '<div class="error">Unable to load experiment: ' + escapeHtml(error.message) + '</div><a class="btn" href="/">Back to dashboard</a>';
    }
  }
  (window.AppComponentsReady || Promise.resolve()).then(boot);
})();