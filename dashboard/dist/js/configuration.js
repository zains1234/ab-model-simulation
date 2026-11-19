(function () {
  "use strict";
  var name = getRouteName();
  var draftRecord = null;
  var originalSnapshot = null;
  var isNewDraft = false;
  var pendingNavigation = null;
  var bypassGuard = false;

  function currentData() {
    var base = cloneData(draftRecord && draftRecord.data || originalSnapshot || {});
    var collected = collectExpData();
    var oldModels = Array.isArray(base.models) ? base.models : [];
    collected.models = collected.models.map(function (model) {
      var oldModel = oldModels.find(function (item) { return item.name === model.name; }) || {};
      return Object.assign({}, oldModel, model);
    });
    var oldEvents = base.events || {};
    Object.keys(collected.events || {}).forEach(function (key) {
      var oldEvent = oldEvents[key] || {};
      var newEvent = collected.events[key] || {};
      if (newEvent.type === "experiment") {
        var oldEventModels = oldEvent.models || {};
        Object.keys(newEvent.models || {}).forEach(function (modelName) {
          newEvent.models[modelName] = Object.assign({}, oldEventModels[modelName] || {}, newEvent.models[modelName]);
        });
      }
      collected.events[key] = Object.assign({}, oldEvent, newEvent);
    });
    return Object.assign({}, base, collected);
  }

  function isDirty() {
    if (isNewDraft) return true;
    try { return stableStringify(currentData()) !== stableStringify(originalSnapshot); }
    catch (_) { return true; }
  }

  function updateUnloadGuard() {
    window.onbeforeunload = isDirty() ? function (event) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    } : null;
  }

  function showUnsavedModal(destination) {
    pendingNavigation = destination || "/";
    var modal = document.getElementById("unsaved_modal");
    if (modal) modal.classList.remove("hidden");
  }

  function continueNavigation() {
    bypassGuard = true;
    window.onbeforeunload = null;
    if (pendingNavigation) location.href = pendingNavigation;
  }

  function initGuard() {
    var stay = document.getElementById("stay_editing_btn");
    var discard = document.getElementById("discard_changes_btn");
    if (stay) stay.addEventListener("click", function () {
      document.getElementById("unsaved_modal").classList.add("hidden");
      pendingNavigation = null;
    });
    if (discard) discard.addEventListener("click", function () {
      if (isNewDraft) TempWorkspace.removeDraft(name);
      continueNavigation();
    });
    document.addEventListener("click", function (event) {
      var anchor = event.target.closest("a[href]");
      if (!anchor || anchor.target || anchor.getAttribute("href") === "#" || anchor.origin !== location.origin || anchor.href === location.href) return;
      if (!isDirty() || bypassGuard) return;
      event.preventDefault();
      showUnsavedModal(anchor.href);
    });
  }

  function showExperimentStatus(data, isTemp) {
    var status = document.getElementById("detail_status");
    if (!status) return;
    status.textContent = (isTemp ? "TEMP · " : "") + data.status[0].toUpperCase() + data.status.slice(1);
    status.className = "status " + (isTemp ? "temp" : data.status);
  }

  window.showHome = function () {
    if (isDirty()) showUnsavedModal("/");
    else location.href = "/";
  };
  window.closeExperiment = window.showHome;
  window.showDetailTab = function (tab) {
    if (tab === "simulation") {
      if (isDirty()) showUnsavedModal("/simulation/" + encodeURIComponent(name));
      else location.href = "/simulation/" + encodeURIComponent(name);
    }
  };

  window.saveExperiment = async function () {
    if (variantJsonEditing) {
      document.getElementById("variant_json_error").textContent = "Apply or cancel the JSON changes before saving the experiment.";
      return;
    }
    var data = currentData();
    if (!validate(data)) return;
    data.updated_at = new Date().toISOString();
    if (isNewDraft) {
      data.version = "1.0";
    } else {
      var parts = normalizeVersion(originalSnapshot.version).split(".").map(Number);
      data.version = document.getElementById("version_type").value === "major"
        ? (parts[0] + 1) + ".0" : parts[0] + "." + (parts[1] + 1);
    }

    try {
      var kind = isNewDraft ? "create" : (draftRecord.kind === "create" ? "create" : "update");
      var baseName = isNewDraft ? null : (draftRecord.baseName || name);
      TempWorkspace.save(data, kind, baseName);
      if (isNewDraft) TempWorkspace.removeDraft(name);
      originalSnapshot = TempWorkspace.cleanForExport(data);
      window.onbeforeunload = null;
      notify("Saved locally as TEMP. The CDN is unchanged; export and deploy manually.");
      location.href = "/";
    } catch (error) {
      showValidationAlert([error.message]);
      notify("Could not save to browser storage: " + error.message, "error");
    }
  };

  async function boot() {
    initGuard();
    try {
      var cdnExperiments = [];
      try { cdnExperiments = await loadCdnExperiments(); }
      catch (cdnError) { console.warn("CDN unavailable while opening configuration:", cdnError); }
      experiments = TempWorkspace.merge(cdnExperiments).map(migrateExperiment);

      var storedDraft = TempWorkspace.getDraft(name);
      var data;
      if (storedDraft) {
        draftRecord = storedDraft;
        isNewDraft = true;
        editingId = null;
        data = migrateExperiment(cloneData(storedDraft.data));
        document.getElementById("create_edit_experiment").textContent = storedDraft.kind === "duplicate" ? "Duplicate Experiment" : "Create Experiment";
        document.getElementById("saved_version").textContent = "Unsaved draft · stored temporarily in this browser";
        showExperimentStatus(data, true);
      } else {
        var existing = experiments.find(function (item) { return String(item.name).toLowerCase() === String(name).toLowerCase(); });
        if (!existing) throw new Error("Experiment not found in the CDN configuration or temporary workspace.");
        data = migrateExperiment(TempWorkspace.cleanForExport(existing));
        originalSnapshot = cloneData(data);
        draftRecord = {
          kind: existing.__workspaceKind || "update",
          baseName: existing.__workspaceBaseName || existing.name,
          data: cloneData(data)
        };
        editingId = existing.name;
        document.getElementById("create_edit_experiment").textContent = "Edit Experiment";
        document.getElementById("saved_version").textContent = (TempWorkspace.isTemp(existing) ? "TEMP workspace" : "Published CDN configuration") + " · v" + normalizeVersion(data.version);
        showExperimentStatus(data, TempWorkspace.isTemp(existing));
      }

      document.getElementById("experiment_id").value = data.id;
      document.getElementById("experiment_name").value = data.name;
      document.getElementById("experiment_status").value = data.status;
      document.getElementById("experiment_version").value = normalizeVersion(data.version);
      document.getElementById("version_type").value = "minor";
      renderExpTarget(data.target || {});
      renderExpModels(data.models || [], data.events || {});
      document.getElementById("detail_title").textContent = data.name;
      document.getElementById("breadcrumb_name").textContent = data.name;
      document.getElementById("simulation_id").value = data.id;
      document.getElementById("detail_page").classList.add("active");

      var simulationLink = document.getElementById("open_simulation_link");
      if (simulationLink) simulationLink.href = "/simulation/" + encodeURIComponent(data.name);
      document.getElementById("configuration_view").classList.remove("hidden");

      document.addEventListener("input", function (event) {
        if (event.target.closest("#configuration_view")) updateUnloadGuard();
      });
      document.addEventListener("change", function (event) {
        if (event.target.closest("#configuration_view")) updateUnloadGuard();
      });
      document.addEventListener("click", function (event) {
        if (event.target.closest("#configuration_view")) updateUnloadGuard();
      });
      updateUnloadGuard();
    } catch (error) {
      document.querySelector("main").innerHTML = '<div class="error">Unable to load experiment: ' + escapeHtml(error.message) + '</div><a class="btn" href="/">Back to dashboard</a>';
    }
  }

  (window.AppComponentsReady || Promise.resolve()).then(boot);
})();
