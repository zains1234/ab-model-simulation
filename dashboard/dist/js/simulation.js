(function () {
  "use strict";
  async function boot() {
    var name = getRouteName();
    try {
      var cdnExperiments = [];
      try { cdnExperiments = await loadCdnExperiments(); }
      catch (cdnError) { console.warn("CDN unavailable while opening simulation:", cdnError); }
      experiments = TempWorkspace.merge(cdnExperiments).map(migrateExperiment);
      var exp = experiments.find(function (item) { return String(item.name).toLowerCase() === String(name).toLowerCase(); });
      if (!exp) throw new Error("Experiment not found in the CDN configuration or temporary workspace.");

      experiments = [exp];
      document.getElementById("simulation_id").value = exp.id;
      document.getElementById("detail_title").textContent = exp.name;
      document.getElementById("breadcrumb_name").textContent = exp.name;
      document.getElementById("detail_status").textContent = (TempWorkspace.isTemp(exp) ? "TEMP · " : "") + exp.status[0].toUpperCase() + exp.status.slice(1);
      document.getElementById("detail_status").className = "status " + (TempWorkspace.isTemp(exp) ? "temp" : exp.status);
      document.getElementById("saved_version").textContent = (TempWorkspace.isTemp(exp) ? "TEMP workspace" : "Published CDN configuration") + " · v" + normalizeVersion(exp.version);
      document.getElementById("back_configuration_link").href = "/configuration/" + encodeURIComponent(exp.name);
      document.getElementById("simulation_view").classList.remove("hidden");
      renderSimulationContext();
    } catch (error) {
      document.querySelector("main").innerHTML = '<div class="error">Unable to load experiment: ' + escapeHtml(error.message) + '</div><a class="btn" href="/">Back to dashboard</a>';
    }
  }
  (window.AppComponentsReady || Promise.resolve()).then(boot);
})();
