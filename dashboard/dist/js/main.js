(function () {
  "use strict";

  async function loadSavedExperiments() {
    var cdnExperiments = [];
    var cdnError = null;
    try {
      cdnExperiments = await loadCdnExperiments();
    } catch (error) {
      cdnError = error;
      console.warn("CDN configuration could not be loaded; showing available temporary workspace data.", error);
    }

    try {
      experiments = TempWorkspace.merge(cdnExperiments).map(migrateExperiment);
      render();
      if (cdnError && !experiments.length) {
        var rows = document.getElementById("experiment_rows");
        if (rows) rows.innerHTML = '<tr><td colspan="6" class="empty">Unable to load CDN configuration: ' + escapeHtml(cdnError.message) + '</td></tr>';
      } else if (cdnError) {
        notify("CDN is unavailable. Showing temporary local changes only where available.", "error");
      }
    } catch (error) {
      console.error(error);
      var errorRows = document.getElementById("experiment_rows");
      if (errorRows) errorRows.innerHTML = '<tr><td colspan="6" class="empty">' + escapeHtml(error.message) + '</td></tr>';
    }
  }

  function makeUniqueName(prefix) {
    var suffix = String(Date.now()).slice(-6);
    var candidate = (prefix + suffix).slice(0, 16);
    var counter = 1;
    while (experiments.some(function (item) { return String(item.name).toLowerCase() === candidate.toLowerCase(); })) {
      candidate = (prefix.slice(0, 16 - String(counter).length) + counter).slice(0, 16);
      counter++;
    }
    return candidate;
  }

  window.newExperiment = function () {
    var timestamp = Date.now();
    var draft = {
      schema_version: 2,
      id: "experiment_" + timestamp,
      name: makeUniqueName("NewExp"),
      version: "1.0",
      status: "draft",
      target: { project: "", environment: "", platform: "", feature: "" },
      models: [{ name: "modelA", percentage: 50 }, { name: "modelB", percentage: 50 }],
      events: { newsfeed: { type: "experiment", models: {} } }
    };
    TempWorkspace.saveDraft({ kind: "create", baseName: null, data: draft });
    location.href = "/configuration/" + encodeURIComponent(draft.name);
  };

  window.duplicateExperiment = function (experimentName) {
    var source = experiments.find(function (item) { return item.name === experimentName; });
    if (!source) return;
    var draft = cloneData(TempWorkspace.cleanForExport(source));
    draft.id = String(source.id || "experiment") + "_copy_" + Date.now();
    var base = String(source.name || "Experiment").slice(0, 8) + "Copy";
    draft.name = makeUniqueName(base);
    draft.status = "draft";
    draft.version = "1.0";
    TempWorkspace.saveDraft({ kind: "duplicate", baseName: null, sourceName: source.name, data: draft });
    location.href = "/configuration/" + encodeURIComponent(draft.name);
  };

  window.openExperiment = function (name, tab) {
    var experiment = experiments.find(function (item) { return item.name === name; });
    if (!experiment) return;
    location.href = (tab === "simulation" ? "/simulation/" : "/configuration/") + encodeURIComponent(experiment.name);
  };

  window.setExperimentStatus = function (experimentName, status, statusSelect) {
    var current = experiments.find(function (item) { return item.name === experimentName; });
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
      var saved = TempWorkspace.save(updated, current.__workspaceKind, current.__workspaceBaseName || current.name);
      experiments = experiments.map(function (item) { return item.name === current.name ? saved : item; });
      render();
      notify("Saved locally as TEMP. Export and deploy the JSON to CDN manually.");
    } catch (error) {
      if (statusSelect) statusSelect.value = current.status;
      notify("Could not save temporary status: " + error.message, "error");
    }
  };

  window.clearTempChanges = async function () {
    if (!TempWorkspace.count() && !TempWorkspace.draftCount()) {
      notify("There are no temporary changes to clear.");
      return;
    }
    if (!confirm("Clear all temporary changes and unsaved drafts from this browser? Published CDN configurations will remain unchanged.")) return;
    TempWorkspace.clear();
    await loadSavedExperiments();
    notify("Temporary changes cleared. Showing published CDN configurations.");
  };

  window.save = function () { render(); };

  window.addEventListener("storage", function (event) {
    if (event.key === TempWorkspace.storageKey || event.key === TempWorkspace.draftsKey) {
      loadSavedExperiments();
    }
  });

  (window.AppComponentsReady || Promise.resolve()).then(loadSavedExperiments);
})();
