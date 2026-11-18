(function () {
  "use strict";
  async function loadSavedExperiments() {
    try {
      var result = await ApiService.list();
      experiments = result.experiments || [];
      // Keep the existing CDN configuration source as a fallback for a first-time local workspace.
      if (!experiments.length) {
        try {
          await loadConfiguration();
          var imported = experiments.slice();
          for (var i = 0; i < imported.length; i++) {
            try { await ApiService.create(imported[i]); }
            catch (importError) { if (importError.status !== 409) console.warn("Could not import CDN experiment", importError); }
          }
          var refreshed = await ApiService.list();
          experiments = refreshed.experiments || imported;
          render();
        } catch (cdnError) { console.warn("CDN fallback unavailable", cdnError); }
      } else {
        experiments = experiments.map(migrateExperiment);
        render();
      }
    } catch (error) {
      console.error(error);
      var rows = document.getElementById("experiment_rows");
      if (rows) rows.innerHTML = '<tr><td colspan="6" class="empty">' + escapeHtml(error.message) + '</td></tr>';
    }
  }

  window.newExperiment = function () {
    var id = "experiment_" + Date.now();
    var draft = {
      schema_version: 2, id: id, name: "New Experiment", version: "1.0", status: "draft",
      target: { project: "", environment: "", platform: "", feature: "" },
      models: [{ name: "modelA", percentage: 50 }, { name: "modelB", percentage: 50 }],
      events: { newsfeed: { type: "experiment", models: {} } }
    };
    sessionStorage.setItem("abtest-draft:" + id, JSON.stringify({ kind: "new", data: draft }));
    location.href = "/configuration/" + encodeURIComponent(id);
  };

  window.duplicateExperiment = function (exp_id) {
    var source = experiments.find(function (item) { return item.id === exp_id; });
    if (!source) return;
    var draft = cloneData(source);
    draft.id = source.id + "_copy_" + Date.now();
    draft.name = (String(source.name || "Experiment").slice(0, 11) + " copy").slice(0, 16);
    draft.status = "draft";
    draft.version = "1.0";
    sessionStorage.setItem("abtest-draft:" + draft.id, JSON.stringify({ kind: "duplicate", sourceId: exp_id, data: draft }));
    location.href = "/configuration/" + encodeURIComponent(draft.id);
  };

  window.openExperiment = function (id, tab) {
    if (!experiments.some(function (item) { return item.id === id; })) return;
    location.href = (tab === "simulation" ? "/simulation/" : "/configuration/") + encodeURIComponent(id);
  };

  window.setExperimentStatus = async function (exp_id, status, statusSelect) {
    var current = experiments.find(function (item) { return item.id === exp_id; });
    if (!current) return;
    if (["completed", "archived"].includes(current.status) && status === "active") {
      alert("This experiment is already " + current.status + ". Duplicate it to create a new experiment.");
      if (statusSelect) statusSelect.value = current.status;
      return;
    }
    if (status === "archived" && current.status !== "archived" &&
        !confirm("Archive this experiment?\n\nArchived experiments will be excluded from the active configuration export.")) {
      if (statusSelect) statusSelect.value = current.status;
      return;
    }
    var updated = cloneData(current);
    updated.status = status;
    try {
      await ApiService.update(exp_id, updated);
      experiments = experiments.map(function (item) { return item.id === exp_id ? updated : item; });
      render();
      notify("Experiment status updated.");
    } catch (error) {
      if (statusSelect) statusSelect.value = current.status;
      notify("Could not update experiment: " + error.message, "error");
    }
  };

  // Save helper used by the existing table-management logic.
  window.save = function () { render(); };
  (window.AppComponentsReady || Promise.resolve()).then(loadSavedExperiments);
})();