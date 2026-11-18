const CONFIG_URL = "https://cdn.detik.net.id/analytic-model/config/production/index.json"
let experiments = [];
let pendingSavePromise = Promise.resolve();
let lastSaveSucceeded = true;
let editingId = null;
let homeStatus = "all", currentPage = 1, pageSize = 8, selectedPreviewId = null, detailTab = "configuration";
let newExperimentInitialized = false;
const unsavedExperimentIds = new Set();
const DEFAULT_TARGETS = ["project", "environment", "platform", "feature"];
const MODEL_COLORS = ["#334155", "#0f766e", "#2563eb", "#c0841a", "#7c3aed", "#be123c", "#0891b2", "#4d7c0f", "#9333ea", "#b45309", "#475569", "#0d9488"];

async function loadConfiguration() {
  try {
    // Prefer the locally saved workspace when running Version 1.
    // If there is no temporary workspace, load the published CDN config.
    try {
      const draftResponse = await fetch("/api/draft");
      if (draftResponse.ok) {
        const draft = await draftResponse.json();
        if (draft.hasDraft && Array.isArray(draft.experiments)) {
          experiments = draft.experiments.map(migrateExperiment);
          setWorkspaceStatus("Local draft restored", "success");
          render();
          return;
        }
        setWorkspaceStatus("No local changes", "normal");
      }
    } catch (draftError) {
      setWorkspaceStatus("Local server unavailable", "error");
    }

    const response = await fetch(CONFIG_URL);

    if (!response.ok) {
      throw new Error(
        "Failed to load configuration: HTTP " + response.status
      );
    }

    const manifest = await response.json();

    if (manifest.schema_version !== 3) {
      throw new Error(
        "Unsupported configuration schema: " +
        manifest.schema_version
      );
    }

    experiments = [];

    for (const manifestExperiment of manifest.experiments || []) {

      const response = await fetch(
        new URL(
          manifestExperiment.config_url,
          CONFIG_URL
        )
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load experiment: " +
          manifestExperiment.id
        );
      }

      const experiment = await response.json();

      experiments.push(
        migrateExperiment(experiment)
      );
    }

    render();

  } catch (error) {

    console.error("Configuration loading failed:", error);

    document.getElementById("experiment_rows").innerHTML =
      '<tr><td colspan="6" class="empty">' +
      'Failed to load configuration.<br>' +
      escapeHtml(error.message) +
      '</td></tr>';
  }
}
function migrateExperiment(exp_item) {
  exp_item = exp_item || {};
  if (!Array.isArray(exp_item.models)) {
    const first = Object.values(exp_item.events || {}).find(
      (rec_item) => rec_item && rec_item.type === "experiment" && Array.isArray(rec_item.models),
    );
    exp_item.models = (first ? first.models : []).map((model_item) => ({
      name: model_item.name,
      percentage: Number(model_item.percentage),
    }));
  }
  exp_item.models = exp_item.models.map((model_item) => ({
    name: String(model_item.name || ""),
    percentage: Number(model_item.percentage || 0),
  }));
  Object.keys(exp_item.events || {}).forEach((rec_key) => {
    const rec_item = exp_item.events[rec_key];
    if (rec_item && rec_item.type === "experiment" && Array.isArray(rec_item.models)) {
      const map = {};
      rec_item.models.forEach((model_item) => {
        map[model_item.name] = {
          url: model_item.url || "",
          tracking_rec: model_item.tracking_rec || model_item.name,
        };
      });
      exp_item.events[rec_key] = { type: "experiment", models: map };
    } else if (rec_item && rec_item.type === "static") {
      exp_item.events[rec_key] = {
        type: "static",
        url: rec_item.url || "",
        tracking_rec: rec_item.tracking_rec || "",
      };
    }
  });
  exp_item.target=exp_item.target||{};
  exp_item.version=normalizeVersion(exp_item.version);
  exp_item.schema_version = 2;
  return exp_item;
}
function escapeHtml(x) {
  return String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
function setWorkspaceStatus(message, state = "normal") {
  const status = document.getElementById("workspace_status");
  if (!status) return;
  status.textContent = message;
  status.style.color = state === "success" ? "#087a3a" : state === "error" ? "#b42318" : "#777";
}

function save() {
  render();
  setWorkspaceStatus("Saving local temporary files…");
  pendingSavePromise = (async () => {
    try {
      const response = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experiments: experiments.filter(item => !unsavedExperimentIds.has(item.id)) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Local save failed");
      lastSaveSucceeded = true;
      setWorkspaceStatus("Saved to project temp/", "success");
    } catch (error) {
      lastSaveSucceeded = false;
      console.error("Local workspace save failed:", error);
      setWorkspaceStatus("Save failed — start the local server", "error");
      alert("Could not save the temporary configuration. Make sure you started the project with npm start.\n\n" + error.message);
    }
  })();
  return pendingSavePromise;
}

async function submitToCdn() {
  const confirmed = confirm(
    "Submit the generated configuration using the server deployment command?\n\nTemporary files will only be removed if the deployment command succeeds."
  );
  if (!confirmed) return;
  setWorkspaceStatus("Submitting configuration…");
  try {
    await pendingSavePromise;
    if (!lastSaveSucceeded) throw new Error("The latest local save failed. Fix the local server connection and save again before submitting.");
    const response = await fetch("/api/deploy", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Deployment failed");
    setWorkspaceStatus("Submitted — temporary files cleared", "success");
    alert(result.message || "Deployment completed successfully.");
  } catch (error) {
    setWorkspaceStatus("Not submitted — temporary files kept", "error");
    alert("Submission was not completed. Your temporary files were kept.\n\n" + error.message);
  }
}
function render() {
  const search_exp = document.getElementById("search_exp").value.toLowerCase();
  const projectFilter = document.getElementById("project_filter").value;
  const archiveFilter = document.getElementById("archive_filter").value;
  ["all","active","paused","draft","completed"].forEach(status => {
    const count = status === "all" ? experiments.filter(x=>x.status!=="archived").length : experiments.filter(x=>x.status===status).length;
    const el=document.getElementById("count_"+status); if(el) el.textContent=count;
  });
  const projects=[...new Set(experiments.map(x=>(x.target||{}).project).filter(Boolean))];
  const projectSelect=document.getElementById("project_filter"), previousProject=projectSelect.value;
  projectSelect.innerHTML='<option value="">All projects</option>'+projects.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  projectSelect.value=projects.includes(previousProject)?previousProject:"";
  let filtered=experiments.filter(exp=>{
    const statusOk=homeStatus==="all" ? (archiveFilter==="show" || exp.status!=="archived") : exp.status===homeStatus;
    const archiveOk=homeStatus==="all" && archiveFilter==="hide" ? exp.status!=="archived" : true;
    const queryOk=!search_exp || (String(exp.id)+" "+String(exp.name)).toLowerCase().includes(search_exp);
    const projectOk=!projectSelect.value || (exp.target||{}).project===projectSelect.value;
    return statusOk && archiveOk && queryOk && projectOk;
  });
  if (selectedPreviewId && !filtered.some(exp => exp.id === selectedPreviewId)) {
    selectedPreviewId = null;
  }
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize)); currentPage=Math.min(currentPage,totalPages);
  const visible=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);
  document.getElementById("experiment_rows").innerHTML=visible.map(exp=>{
    const target=exp.target||{}; const audience=[target.project,target.environment].filter(Boolean).join(" / "); const detail=[target.platform,target.feature].filter(Boolean).join(" · ");
    return `<tr data-id="${escapeHtml(exp.id)}" class="${selectedPreviewId===exp.id?'selected':''}"><td class="check-cell"><input class="experiment-check" type="checkbox" aria-label="Show ${escapeHtml(exp.name)} in current configuration" ${selectedPreviewId===exp.id?'checked':''} onclick="event.stopPropagation()" onchange="selectPreview('${escapeHtml(exp.id)}', this.checked)"></td><td><b>${escapeHtml(exp.name)}</b><div class="muted">${escapeHtml(exp.id)}</div></td><td><span class="status ${escapeHtml(exp.status)}">${escapeHtml(exp.status[0].toUpperCase()+exp.status.slice(1))}</span></td><td>${escapeHtml(audience||"—")}<div class="muted">${escapeHtml(detail)}</div></td><td>v${escapeHtml(exp.version||"1.0")}</td><td> <div class="row-actions">
      <button class="btn action-icon" type="button" title="Open configuration" aria-label="Open configuration"
        onclick="event.stopPropagation(); openExperiment('${escapeHtml(exp.id)}','configuration')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9"/>
          <circle cx="15" cy="7" r="2"/>
          <circle cx="9" cy="17" r="2"/>
        </svg>
      </button>
      <button class="btn action-icon" type="button" title="Duplicate experiment" aria-label="Duplicate experiment"
        onclick="event.stopPropagation(); duplicateExperiment('${escapeHtml(exp.id)}')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="12" height="12" rx="2"/>
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>
        </svg>
      </button>
      <select class="action-status" aria-label="Change experiment status"
        onclick="event.stopPropagation()"
        onchange="event.stopPropagation(); setExperimentStatus('${escapeHtml(exp.id)}', this.value, this)">
        <option value="draft" ${exp.status === "draft" ? "selected" : ""}>Draft</option>
        <option value="active" ${exp.status === "active" ? "selected" : ""}>Active</option>
        <option value="paused" ${exp.status === "paused" ? "selected" : ""}>Paused</option>
        <option value="completed" ${exp.status === "completed" ? "selected" : ""}>Completed</option>
        <option value="archived" ${exp.status === "archived" ? "selected" : ""}>Archived</option>
      </select>
    </div> </td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">No experiments found</td></tr>';
  document.getElementById("pagination_info").textContent=filtered.length?`Showing ${(currentPage-1)*pageSize+1}–${Math.min(currentPage*pageSize,filtered.length)} of ${filtered.length} experiments`:"Showing 0 experiments";
  renderCurrentConfigurations(filtered);
}
function setHomeStatus(status){homeStatus=status;currentPage=1;document.querySelectorAll("#home_status_tabs .tab").forEach(t=>t.classList.toggle("active",t.dataset.status===status));render();}
function changePage(direction){currentPage=Math.max(1,currentPage+direction);render();}
function selectPreview(id, checked){selectedPreviewId=checked?id:null;render();}
function renderCurrentConfigurations(list=experiments){
  const selected=selectedPreviewId?list.filter(x=>x.id===selectedPreviewId):list;
  document.getElementById("current_config_sub").textContent=selectedPreviewId?(selected[0]?.name||"Selected experiment"):"Experiment overview";
  document.getElementById("current_configuration_list").innerHTML=selected.length?selected.map(exp=>{
    const target=exp.target||{}, models=exp.models||[], total=models.reduce((s,m)=>s+Number(m.percentage||0),0), remaining=Math.max(0,100-total);
    const allocationScale=total>100?100/total:1;
    const bars=models.map((m,i)=>`<span title="${escapeHtml(m.name)} · ${Number(m.percentage)||0}%" style="width:${Math.max(0,Number(m.percentage)||0)*allocationScale}%;background:${MODEL_COLORS[i%MODEL_COLORS.length]}"></span>`).join("")+(total<=100?`<span style="width:${remaining}%;background:#e5e7eb"></span>`:"");
    const legend=models.map((m,i)=>`<span><i class="dot" style="background:${MODEL_COLORS[i%MODEL_COLORS.length]}"></i>${escapeHtml(m.name)} &nbsp;${Number(m.percentage)||0}%</span>`).join("")+ (remaining>0?`<span><i class="dot" style="background:#e5e7eb"></i>Unassigned &nbsp;${remaining.toFixed(2)}%</span>`:"");
    return `<article class="config-item ${selectedPreviewId===exp.id?'selected':''}"><div class="config-item-head"><div><h3>${escapeHtml(exp.name)}</h3><div class="muted">${escapeHtml(exp.id)}</div></div><span class="status ${escapeHtml(exp.status)}">${escapeHtml(exp.status)}</span></div><div class="audience-line">Audience</div><div class="config-meta">${escapeHtml([target.project,target.environment,target.platform,target.feature].filter(Boolean).join(" · ")||"No audience configured")}</div><div class="config-meta">Configuration &nbsp; ${Object.keys(exp.events||{}).length} key · ${models.length} variant values</div><div class="config-meta">Traffic allocation</div><div class="allocation">${bars}</div><div class="legend"><div class="legend-items">${legend}</div></div><div class="config-actions">
      <button class="btn config-action-btn" type="button" onclick="openExperiment('${escapeHtml(exp.id)}','configuration')" title="Open configuration">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 14 4l1.1 2.1 2.3.9 2.2-.5 1.1 1.9-1.2 2 .2 2.5 1.4 1.8-1.1 1.9-2.3-.2-2 1.4-.7 2.2h-2.2l-.8-2.2-2-1.4-2.3.2-1.1-1.9 1.4-1.8.2-2.5-1.2-2 1.1-1.9 2.2.5 2.3-.9L12 3.5Z"/><circle cx="13" cy="12" r="3"/></svg>
        <span>Open configuration</span>
      </button>
      <button class="btn config-action-btn" type="button" onclick="openExperiment('${escapeHtml(exp.id)}','simulation')" title="Test assignment">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5.2 8.4A2.4 2.4 0 0 0 6.9 21h10.2a2.4 2.4 0 0 0 2.1-3.6L14 9V3"/><path d="M7.5 15h9"/><circle cx="10" cy="17.5" r=".7"/><circle cx="14.5" cy="13" r=".7"/></svg>
        <span>Test assignment</span>
      </button>
    </div></article>`;
  }).join(""):'<div class="empty">No experiment configuration to display.</div>';
}
search_exp.oninput = () => {currentPage=1;render();};
document.getElementById("home_page").addEventListener("click", function(event){
  if (!event.target.closest(".table-wrap") && !event.target.closest(".current-list") && selectedPreviewId) {
    selectedPreviewId=null;
    render();
  }
});
function newExperiment() {
  const path = routeForExperiment("new", "configuration");
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
  setupNewExperiment();
}
function setupNewExperiment() {
  newExperimentInitialized = true;
  editingId = null;
  document.getElementById("create_edit_experiment").textContent = "Create Experiment";
  document.getElementById("experiment_id").value = "experiment_" + Date.now();
  document.getElementById("experiment_name").value = "New Experiment";
  document.getElementById("experiment_status").value = "draft";
  document.getElementById("experiment_version").value = "1.0";
  document.getElementById("version_type").value = "minor";
  renderExpTarget({ project:"", environment:"", platform:"", feature:"" });
  renderExpModels(
    [
      { name: "modelA", percentage: 50 },
      { name: "modelB", percentage: 50 },
    ],
    { newsfeed: { type: "experiment", models: {} } },
  );
  document.getElementById("detail_title").textContent="New experiment"; document.getElementById("breadcrumb_name").textContent="New experiment"; document.getElementById("detail_status").textContent="Draft"; document.getElementById("detail_status").className="status draft"; document.getElementById("saved_version").textContent="Unsaved configuration"; document.getElementById("simulation_id").value=document.getElementById("experiment_id").value; document.getElementById("home_page").classList.remove("active"); document.getElementById("detail_page").classList.add("active"); showDetailTab("configuration", false);
}
function editExperiment(exp_id) {
  const experiment_data = experiments.find((exp_item) => exp_item.id === exp_id);
  if (!experiment_data) return;
  editingId = exp_id;
  document.getElementById("create_edit_experiment").textContent = "Edit Experiment";
  document.getElementById("experiment_id").value = experiment_data.id;
  document.getElementById("experiment_name").value = experiment_data.name;
  document.getElementById("experiment_status").value = experiment_data.status;
  document.getElementById("experiment_version").value = normalizeVersion(experiment_data.version);
  document.getElementById("version_type").value = "minor";
  renderExpTarget(experiment_data.target || {});
  renderExpModels(experiment_data.models || [], experiment_data.events || {});
  document.getElementById("detail_title").textContent=experiment_data.name; document.getElementById("breadcrumb_name").textContent=experiment_data.name; document.getElementById("detail_status").textContent=experiment_data.status[0].toUpperCase()+experiment_data.status.slice(1); document.getElementById("detail_status").className="status "+experiment_data.status; document.getElementById("saved_version").textContent="Saved configuration · v"+normalizeVersion(experiment_data.version); document.getElementById("simulation_id").value=experiment_data.id;
}
function closeExperiment() { showHome(); }
function renderExpTarget(exp_target) {
  const box=document.getElementById("experiment_target"); box.innerHTML="";
  DEFAULT_TARGETS.forEach(key=>addExpTarget(key,exp_target[key]||"",false,true));
  Object.entries(exp_target).filter(([key])=>!DEFAULT_TARGETS.includes(key)).forEach(([key,value])=>addExpTarget(key,value,true,false));
}
function addExpTarget(key = "", value = "", custom = true, isDefault = false) {
  const exp_target_item=document.createElement("div"); exp_target_item.className="target-row"+(isDefault?" default":"");
  exp_target_item.innerHTML=`<div class="input-container"><label>${isDefault?key[0].toUpperCase()+key.slice(1)+" *":"Target key"}</label><input class="target-key" placeholder="key" value="${escapeHtml(key)}" ${isDefault?'readonly':''}></div><div class="input-container"><label>${isDefault?'Required value':'Target value'}</label><input class="target-value" placeholder="Enter ${escapeHtml(key||'target')} value" value="${escapeHtml(value)}" ${isDefault?'required':''}></div>${isDefault?'<span class="muted">Required</span>':'<button class="btn small" type="button" onclick="this.parentNode.remove()">Remove</button>'}`;
  document.getElementById("experiment_target").appendChild(exp_target_item);
}
function currentModels() {
  return [...document.querySelectorAll("#model_list_section>.model-row")].map(
    (model_item) => ({
      name: model_item.querySelector(".model-name").value.trim(),
      percentage: Number(model_item.querySelector(".model-percentage").value),
    }),
  );
}
function currentEvents() {
  const rec_data = {};

  document
    .querySelectorAll("#recomendation_list_section > .event-card")
    .forEach((rec_item) => {

      const rec_name =
        rec_item.querySelector(".event-name")?.value.trim();

      if (!rec_name) return;

      if (rec_data[rec_name]) {
        return;
      }

      const type =
        rec_item.querySelector(".event-type")?.value ||
        "experiment";

      // ==========================================
      // STATIC EVENT
      // ==========================================

      if (type === "static") {

        rec_data[rec_name] = {
          type: "static",
          url:
            rec_item.querySelector(".rec-static-url")?.value.trim() ||
            "",

          tracking_rec:
            rec_item.querySelector(".rec-static-tracking")?.value.trim() ||
            ""
        };

        return;
      }

      // ==========================================
      // EXPERIMENT EVENT
      // ==========================================

      const models = {};

      rec_item
        .querySelectorAll(".rec-model-row")
        .forEach((model_item) => {

          const model_name = model_item.dataset.model;

          models[model_name] = {
            url:
              model_item.querySelector(".rec-model-url")?.value.trim() ||
              "",
            tracking_rec:
              model_item.querySelector(".rec-model-tracking")?.value.trim() ||
              ""
          };
        });

      rec_data[rec_name] = {
        type: "experiment",
        models
      };
    });

  return rec_data;
}
function renderExpModels(models, recs) {
  const models_box = document.getElementById("model_list_section");
  models_box.innerHTML = "";
  models.forEach((model_item) => models_box.appendChild(renderModelRow(model_item)));
  updateModelTotalPercentage();
  syncEvents(recs || currentEvents());
}
function addModel(name, percentage, rerender = true) {
  const models = currentModels();
  if (!name) {
    let i = 65;
    do {
      name = "model" + String.fromCharCode(i++);
    } while (models.some((model_item) => model_item.name === name));
  }
  models.push({ name, percentage: Number(percentage || 0) });
  const recs = currentEvents();
  renderExpModels(models, recs);
  if (rerender) updateModelTotalPercentage();
}
function removeModel(name) {
  const models =
    currentModels().filter(
      (model_item) => model_item.name !== name
    );

  if (models.length < 2) {
    alert("At least 2 models are required.");
    return;
  }

  const recs =
    currentEvents();

  Object.values(recs).forEach((rec_item) => {

    if (
      rec_item.type === "experiment" &&
      rec_item.models
    ) {
      delete rec_item.models[name];
    }

  });

  renderExpModels(models, recs);
}
function renameModel(oldName, newName, models) {
  newName = newName.trim();

  if (!newName || newName === oldName) {
    return;
  }

  if (
    models.some(
      (model_item) =>
        model_item.name === newName
    )
  ) {

    alert("Model names must be unique.");

    renderExpModels(
      models,
      currentEvents()
    );

    return;
  }

  const recs =
    currentEvents();

  Object.values(recs).forEach((rec_item) => {

    if (
      rec_item.type === "experiment" &&
      rec_item.models &&
      rec_item.models[oldName]
    ) {

      rec_item.models[newName] =
        rec_item.models[oldName];

      delete rec_item.models[oldName];

      rec_item.models[newName].tracking_rec =
        newName;
    }

  });

  renderExpModels(
    models.map((model_item) =>
      model_item.name === oldName
        ? {
            name: newName,
            percentage: model_item.percentage
          }
        : model_item
    ),
    recs
  );
}
function bindModelRows() {
  document.querySelectorAll("#model_list_section .model-name").forEach((input) => {
    input.onfocus = () => {
      input.dataset.previousModels = JSON.stringify(currentModels());
    };

    input.onchange = () => {
      const previousModels = JSON.parse(input.dataset.previousModels || "[]");
      delete input.dataset.previousModels;

      renameModel(input.dataset.original, input.value, previousModels);
    };
  });
  document
    .querySelectorAll("#model_list_section .model-percentage")
    .forEach((input) => (input.oninput = updateModelTotalPercentage));
}
function renderModelRow(model_item) {
  const model_el = document.createElement("div");
  model_el.className = "model-row";
  model_el.innerHTML = `
    <input class="model-name" data-original="${escapeHtml(model_item.name)}" value="${escapeHtml(model_item.name)}">
    <input class="model-percentage" type="number" min="0.01" step="0.01" value="${Number(model_item.percentage)}">
    <div class="model-meta">
      Used by every experiment event
    </div>
    <button type="button" onclick="removeModel('${escapeHtml(model_item.name)}')">
      ×
    </button>
  `;
  return model_el;
}
function updateModelTotalPercentage() {
  const total = currentModels().reduce(
    (result, model_item) => result + Number(model_item.percentage || 0),
    0,
  );
  const remaining = Math.max(0, 100 - total);
  const valid_total = total > 0 && total <= 100 + 1e-9;

  document.getElementById("model_total").textContent =
    "Total: " +
    total +
    "%" +
    (valid_total
      ? " ✓ — Unassigned: " + remaining.toFixed(2) + "%"
      : " — must be greater than 0% and no more than 100%");
  bindModelRows();
  updateAllocationVisual();
}
function syncEvents(recs) {
  const normalized = recs || {};
  document.getElementById("recomendation_list_section").innerHTML = "";
  Object.entries(normalized).forEach(([key, value]) => addRec(key, value, false));
  updateModelTotalPercentage();
}
let variantJsonEditing = false;

function toggleVariantJson() {
  if (variantJsonEditing) { cancelVariantJson(); return; }
  document.getElementById("variant_json_text").value = JSON.stringify(currentEvents(), null, 2);
  document.getElementById("variant_json_error").textContent = "";
  document.getElementById("variant_json_editor").classList.remove("hidden");
  document.getElementById("recomendation_list_section").classList.add("hidden");
  document.getElementById("variant_add_event").classList.add("hidden");
  document.getElementById("variant_json_toggle").textContent = "Close JSON editor";
  variantJsonEditing = true;
}

function cancelVariantJson() {
  document.getElementById("variant_json_editor").classList.add("hidden");
  document.getElementById("recomendation_list_section").classList.remove("hidden");
  document.getElementById("variant_add_event").classList.remove("hidden");
  document.getElementById("variant_json_toggle").textContent = "Edit as JSON";
  document.getElementById("variant_json_error").textContent = "";
  variantJsonEditing = false;
}

function validateVariantJson(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("The JSON root must be an object of event configurations.");
  Object.entries(data).forEach(([eventKey, eventConfig]) => {
    if (!eventKey.trim()) throw new Error("Event keys cannot be empty.");
    if (!eventConfig || typeof eventConfig !== "object" || Array.isArray(eventConfig))
      throw new Error('Event "' + eventKey + '" must contain an object.');
    if (!["experiment", "static"].includes(eventConfig.type))
      throw new Error('Event "' + eventKey + '" type must be "experiment" or "static".');
    if (eventConfig.type === "static") return;
    if (!eventConfig.models || typeof eventConfig.models !== "object" || Array.isArray(eventConfig.models))
      throw new Error('Experiment event "' + eventKey + '" must contain a models object.');
    Object.entries(eventConfig.models).forEach(([modelName, modelConfig]) => {
      if (!modelName.trim()) throw new Error('Event "' + eventKey + '" contains an empty variant name.');
      if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig))
        throw new Error('Variant "' + modelName + '" in event "' + eventKey + '" must contain an object.');
      ["url", "tracking_rec"].forEach((field) => {
        if (modelConfig[field] !== undefined && typeof modelConfig[field] !== "string")
          throw new Error('Variant "' + modelName + '" field "' + field + '" must be a string.');
      });
    });
  });
  return data;
}

function applyVariantJson() {
  const errorBox = document.getElementById("variant_json_error");
  try {
    const parsed = validateVariantJson(
      JSON.parse(document.getElementById("variant_json_text").value)
    );
    const modelNames = currentModels().map((model_item) => model_item.name);
    Object.values(parsed).forEach((eventConfig) => {
      if (eventConfig.type !== "experiment") return;
      const suppliedModels = eventConfig.models || {};
      eventConfig.models = {};
      modelNames.forEach((modelName) => {
        const supplied = suppliedModels[modelName] || {};
        eventConfig.models[modelName] = {
          url: typeof supplied.url === "string" ? supplied.url : "",
          tracking_rec: typeof supplied.tracking_rec === "string" ? supplied.tracking_rec : ""
        };
      });
    });
    syncEvents(parsed);
    cancelVariantJson();
  } catch (error) {
    errorBox.textContent = "Invalid variant configuration: " + error.message;
  }
}

function addRec(key = "event", value = null, rerender = true) {
  const existing = currentEvents();

  let key_value = key;
  let n = 1;

  while (existing[key_value]) {
    key_value = key + n++;
  }

  const models = currentModels();

  const event_type =
    value && value.type
      ? value.type
      : "experiment";

  const event_section =
    document.createElement("div");

  event_section.className = "event-card";

  event_section.innerHTML = `
    <div class="event-card-head">

      <div class="event-card-controls">

        <input
          class="event-name"
          placeholder="Event key"
          oninput="preventWhitespace(this)"
          value="${escapeHtml(key_value)}"
        >

        <select class="event-type">
          <option
            value="experiment"
            ${event_type === "experiment" ? "selected" : ""}
          >
            experiment
          </option>

          <option
            value="static"
            ${event_type === "static" ? "selected" : ""}
          >
            static
          </option>
        </select>

      </div>

      <button class="btn small event-remove" type="button"
        onclick="this.closest('.event-card').remove()">
        Remove event
      </button>

    </div>

    <div class="rec-model-list"></div>
  `;

  document
    .getElementById("recomendation_list_section")
    .appendChild(event_section);

  const type_select =
    event_section.querySelector(".event-type");

  // Render the correct fields initially
  renderEventFields(
    event_section,
    event_type,
    models,
    value
  );

  // Change between experiment and static
  type_select.addEventListener("change", function () {

    const current_value = currentEvents()[key_value];

    renderEventFields(
      event_section,
      this.value,
      models,
      current_value
    );

  });

  if (rerender) {
    updateModelTotalPercentage();
  }
}
function renderEventFields(
  event_section,
  event_type,
  models,
  value = null
) {

  const list =
    event_section.querySelector(".rec-model-list");

  list.innerHTML = "";

  // ==========================================
  // STATIC
  // ==========================================

  if (event_type === "static") {

    const source =
      value && value.type === "static"
        ? value
        : {};

    const row = document.createElement("div");

    row.className = "variant-fields-grid rec-static-fields";

    row.innerHTML = `
      <div class="input-container">
        <label>URL</label>

        <input
          class="rec-static-url"
          placeholder="https://..."
          value="${escapeHtml(source.url || "")}"
        >
      </div>

      <div class="input-container">
        <label>Tracking Rec</label>

        <input
          class="rec-static-tracking"
          placeholder="tracking_rec"
          value="${escapeHtml(source.tracking_rec || "")}"
        >
      </div>
    `;

    list.appendChild(row);

    return;
  }

  // ==========================================
  // EXPERIMENT
  // ==========================================

  const source =
    value && value.type === "experiment" && value.models
      ? value.models
      : {};

  models.forEach((model_item) => {

    const saved =
      source[model_item.name] || {};

    const row =
      document.createElement("div");

    row.className = "variant-config-card rec-model-row";

    row.dataset.model =
      model_item.name;

    row.innerHTML = `
      <div class="variant-config-head">
        <div class="variant-name">${escapeHtml(model_item.name)}</div>
        <div class="model-meta">Configuration for this variant</div>
      </div>
      <div class="variant-fields-grid">
        <div class="input-container">
          <label>URL</label>
          <input class="rec-model-url" placeholder="https://..."
            value="${escapeHtml(saved.url || "")}">
        </div>
        <div class="input-container">
          <label>Tracking Rec</label>
          <input class="rec-model-tracking" placeholder="tracking_rec"
            value="${escapeHtml(saved.tracking_rec || "")}">
        </div>
      </div>
    `;

    list.appendChild(row);
  });
}
function collectExpData() {
  const target_data = {};
  document.querySelectorAll("#experiment_target .target-key").forEach((item, idx) => {
    const v = document.querySelectorAll("#experiment_target .target-value")[idx];
    if (item.value.trim()) target_data[item.value.trim()] = v.value.trim();
  });
  return {
    schema_version: 2,
    id: document.getElementById("experiment_id").value.trim(),
    name: document.getElementById("experiment_name").value.trim(),
    version: document.getElementById("experiment_version").value,
    status: document.getElementById("experiment_status").value,
    target: target_data,
    models: currentModels(),
    events: currentEvents(),
  };
}
function findDuplicateExperimentName(exp_data, ignore_item = null) {
  const normalized_name = String(exp_data.name || "")
    .trim()
    .toLowerCase();

  return (
    experiments.find(
      (exp_item) =>
        exp_item !== ignore_item &&
        String(exp_item.name || "")
          .trim()
          .toLowerCase() === normalized_name
    ) || null
  );
}
function findActiveEventConflicts(
  exp_data,
  ignore_id = null
) {
  const conflict_list = [];

  const current_keys = Object.keys(
    exp_data.events || {}
  );

  experiments
    .filter(
      (exp_item) =>
        exp_item.status === "active" &&
        exp_item.id !== ignore_id
    )
    .forEach((exp_item) => {

      const active_keys = Object.keys(
        exp_item.events || {}
      );

      current_keys.forEach((key) => {

        if (active_keys.includes(key)) {

          conflict_list.push({
            key: key,
            experiment_id: exp_item.id,
            experiment_name: exp_item.name
          });

        }

      });

    });

  return conflict_list;
}
function showValidationAlert(errors, success = false) {
  const alertBox = document.getElementById("validation_alert");
  const title = document.getElementById("validation_alert_title");
  const count = document.getElementById("validation_alert_count");
  const list = document.getElementById("validation_alert_list");

  list.innerHTML = "";
  alertBox.classList.toggle("success", success);
  alertBox.classList.remove("hidden");

  if (success) {
    title.textContent = "Configuration is valid";
    count.textContent = "✓";
    const item = document.createElement("li");
    item.textContent = "All validation checks passed.";
    list.appendChild(item);
    return;
  }

  title.textContent = "Please fix the following issues";
  count.textContent = errors.length + (errors.length === 1 ? " error" : " errors");
  errors.forEach((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    list.appendChild(item);
  });
}

function closeValidationAlert() {
  document.getElementById("validation_alert").classList.add("hidden");
}

function validate(exp_data) {
  const error_list = [];

  // ==========================================
  // EXPERIMENT BASIC INFORMATION
  // ==========================================

  if (!exp_data.id) error_list.push("Experiment ID required");
  if (/\s/.test(exp_data.id)) error_list.push("Experiment ID cannot contain whitespace");
  if (experiments.some(x=>x.id===exp_data.id && x.id!==editingId)) error_list.push("Experiment ID must be unique");

  if (!exp_data.name) {
    error_list.push("Name required");
  } else {
    if (exp_data.name.length > 16) {
      error_list.push("Experiment name must be 16 characters or fewer");
    }

    const current_experiment =
      editingId
        ? experiments.find(
            (exp_item) => exp_item.id === editingId
          )
        : null;

    const duplicate_experiment =
      findDuplicateExperimentName(
        exp_data,
        current_experiment
      );

    if (duplicate_experiment) {
      error_list.push(
        "Experiment name \"" +
        exp_data.name +
        "\" is already used by \"" +
        duplicate_experiment.name +
        "\" (" +
        duplicate_experiment.id +
        ")"
      );
    }
  }

  DEFAULT_TARGETS.forEach(key=>{if(!String((exp_data.target||{})[key]||"").trim()) error_list.push(key[0].toUpperCase()+key.slice(1)+" is required");});
  // ==========================================
  // MODELS
  // ==========================================

  if (exp_data.models.length < 2) {
    error_list.push(
      "At least 2 models required"
    );
  }

  const names =
    exp_data.models.map(
      (model_item) => model_item.name
    );

  if (names.some((name) => !name)) {
    error_list.push(
      "Model names are required"
    );
  }

  if (
    new Set(names).size !== names.length
  ) {
    error_list.push(
      "Model names must be unique"
    );
  }

  const total =
    exp_data.models.reduce(
      (result, model_item) =>
        result +
        Number(model_item.percentage || 0),
      0
    );

  if (exp_data.models.some(model_item=>Number(model_item.percentage)<=0 || !Number.isFinite(Number(model_item.percentage)))) error_list.push("Each variant percentage must be greater than 0%");
  if (total <= 0) {
    error_list.push(
      "Model percentages must be greater than 0% in total"
    );
  }

  if (total > 100 + 1e-9) {
    error_list.push(
      "Model percentages must not exceed 100%"
    );
  }

  // ==========================================
  // EVENTS
  // ==========================================
  
  const event_keys =
    Object.keys(exp_data.events);

  if (!event_keys.length) {
    error_list.push(
      "At least 1 event required"
    );
  }

  if (
    new Set(event_keys).size !==
    event_keys.length
  ) {

    error_list.push(
      "Event keys must be unique within the experiment"
    );

  }

  // ==========================================
  // ACTIVE EVENT KEY UNIQUENESS
  // ==========================================

  if (exp_data.status === "active") {

    const active_key_conflicts =
      findActiveEventConflicts(
        exp_data,
        editingId
      );

    active_key_conflicts.forEach(
      (conflict_item) => {

        error_list.push(
          "Event key \"" +
          conflict_item.key +
          "\" is already used by active experiment \"" +
          conflict_item.experiment_name +
          "\" (" +
          conflict_item.experiment_id +
          ")"
        );

      }
    );

  }

  Object.entries(
    exp_data.events
  ).forEach(([key, value]) => {

    if (!key) {
      error_list.push(
        "Event key is required"
      );
      return;
    }

    // ========================================
    // STATIC VALIDATION
    // ========================================

    if (value.type === "static") {

      if (
        !String(value.url || "").trim()
      ) {

        error_list.push(
          key + ": URL required"
        );
      }

      if (
        !String(
          value.tracking_rec || ""
        ).trim()
      ) {

        error_list.push(
          key +
          ": Tracking Rec required"
        );
      }

      return;
    }

    // ========================================
    // EXPERIMENT VALIDATION
    // ========================================

    if (value.type === "experiment") {

      if (!value.models) {

        error_list.push(
          key +
          ": model configuration required"
        );

        return;
      }

      exp_data.models.forEach(
        (model_item) => {

          const model_config =
            value.models[
              model_item.name
            ];

          if (
            !model_config ||
            !String(
              model_config.url || ""
            ).trim()
          ) {

            error_list.push(
              key +
              ": URL required for " +
              model_item.name
            );
          }

        }
      );

      return;
    }

    // ========================================
    // UNKNOWN TYPE
    // ========================================

    error_list.push(
      key +
      ": Invalid event type"
    );

  });

  // ==========================================
  // DISPLAY VALIDATION RESULT
  // ==========================================

  if (error_list.length) {
    showValidationAlert(error_list);
  } else {
    showValidationAlert([], true);
  }

  return !error_list.length;
}
function saveExperiment() {
  if (variantJsonEditing) {
    document.getElementById("variant_json_error").textContent =
      "Apply or cancel the JSON changes before saving the experiment.";
    return;
  }
  const experiment_data = collectExpData();
  if (!validate(experiment_data)) return;
  experiment_data.updated_at = new Date().toISOString();
  if (editingId && !unsavedExperimentIds.has(editingId)) {
    const old=experiments.find(x=>x.id===editingId);
    const parts=normalizeVersion(old?.version).split(".").map(Number);
    experiment_data.version=document.getElementById("version_type").value==="major" ? (parts[0]+1)+".0" : parts[0]+"."+(parts[1]+1);
  } else {
    experiment_data.version="1.0";
    if (editingId) unsavedExperimentIds.delete(editingId);
  }
  if (editingId) {
    const exp_index = experiments.findIndex((exp_item) => exp_item.id === editingId);
    if (exp_index < 0) return;
    // if (experiment_data.status === "active" && experiments[exp_index].status === "active")
    //   experiment_data.version = experiments[exp_index].version + 1;
    experiments[exp_index] = experiment_data;
  } else {
    experiments.push(experiment_data);
    newExperimentInitialized = false;
  }
  save();
  closeExperiment();
}
function setExperimentStatus(exp_id, status, statusSelect) {
  const exp_data =
    experiments.find(
      (exp_item) => exp_item.id === exp_id
    );

  if (!exp_data) return;
  if (unsavedExperimentIds.has(exp_id)) {
    alert("Save and validate this duplicated experiment before changing its status.");
    if (statusSelect) statusSelect.value = exp_data.status;
    return;
  }

  function restoreStatusSelect() {
    if (statusSelect) statusSelect.value = exp_data.status;
  }

  if (
    ["completed", "archived"].includes(exp_data.status) &&
    status === "active"
  ) {
    alert(
      "This experiment is already " +
      exp_data.status +
      ". Duplicate it to create a new experiment."
    );

    restoreStatusSelect();
    return;
  }

  // ==========================================
  // ACTIVE EVENT KEY UNIQUENESS
  // ==========================================

  if (status === "active") {

    const active_key_conflicts =
      findActiveEventConflicts(
        exp_data,
        exp_data.id
      );

    if (active_key_conflicts.length) {

      alert(
        "Cannot activate this experiment.\n\n" +
        active_key_conflicts
          .map(
            (conflict_item) =>
              "Event key \"" +
              conflict_item.key +
              "\" is already used by active experiment \"" +
              conflict_item.experiment_name +
              "\" (" +
              conflict_item.experiment_id +
              ")"
          )
          .join("\n")
      );

      restoreStatusSelect();
      return;
    }
  }

  if (status === "archived" && exp_data.status !== "archived") {
    const confirmed = confirm(
      "Archive this experiment?\n\nArchived experiments will be excluded from the active configuration export."
    );
    if (!confirmed) {
      restoreStatusSelect();
      return;
    }
  }

  exp_data.status = status;

  save();
}
function duplicateExperiment(exp_id) {
  const exp_data = structuredClone(experiments.find((exp_item) => exp_item.id === exp_id));
  if (!exp_data) return;
  exp_data.id = exp_data.id + "_copy_" + Date.now();
  exp_data.name = (exp_data.name + " (Copy)").slice(0, 16);
  exp_data.status = "draft";
  exp_data.version = 1;
  experiments.push(exp_data);
  unsavedExperimentIds.add(exp_data.id);
  // Keep the duplicate in memory only. It is persisted after Save configuration passes validation.
  openExperiment(exp_data.id, "configuration");
}
function preventWhitespace(input) {
  input.value = input.value.replace(/\s/g, '');
}
function download(n, o) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(o, null, 2)], { type: "application/json" }),
  );
  a.download = n;
  a.click();
}
function exportManifest() {
  download("index.json", {
    schema_version: 3,
    config_version: Date.now(),
    generated_at: new Date().toISOString(),

    experiments: experiments
      .filter((exp_item) => exp_item.status === "active")
      .map((exp_item) => ({
        id: exp_item.id,
        name: exp_item.name,
        version: exp_item.version,
        status: exp_item.status,

        // Target metadata is included in the manifest
        // so the SDK can filter experiments before
        // downloading the full experiment JSON.
        target: exp_item.target || {},
        event_keys: Object.keys(
          exp_item.events || {}
        ),
        config_url:
          "./experiments/" +
          exp_item.id +
          "/v" +
          exp_item.version +
          ".json",
      })),
  });
}
async function toFolderName(input) {
  const data = new TextEncoder().encode(String(input));
  const hash = await crypto.subtle.digest("SHA-256", data);

  const hex = Array.from(new Uint8Array(hash))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

  return `folder_${hex.slice(0, 20)}`;
}
async function exportAll() {
  if (typeof JSZip === "undefined") {
    alert("JSZip library is not loaded.");
    return;
  }

  const zip = new JSZip();

  // Get active experiments and calculate folder names once.
  const active_experiments = await Promise.all(
    experiments
      .filter(
        (experiment_item) =>
          experiment_item.status === "active"
      )
      .map(async (experiment_item) => ({
        item: experiment_item,
        folder_name: await toFolderName(
          experiment_item.name
        ),
      }))
  );

  /*
  * Generate index.json.
  * Only active experiments are included.
  */
  const manifest = {
    schema_version: 3,
    config_version: Date.now(),
    generated_at: new Date().toISOString(),

    experiments: active_experiments.map(
      ({ item, folder_name }) => ({
        id: item.id,
        name: item.name,
        version: item.version,
        status: item.status,

        target: item.target || {},
        event_keys: Object.keys(item.events || {}),

        config_url:
          "./experiments/" +
          folder_name +
          "/v" +
          item.version +
          ".json",
      })
    ),
  };

  // Add index.json to the root of the ZIP.
  zip.file(
    "index.json",
    JSON.stringify(manifest, null, 2)
  );

  /*
  * Add experiment configurations.
  * Folder names match the manifest exactly.
  */
  active_experiments.forEach(
    ({ item, folder_name }) => {
      const experiment_path =
        "experiments/" +
        folder_name +
        "/v" +
        item.version +
        ".json";

      zip.file(
        experiment_path,
        JSON.stringify(item, null, 2)
      );
    }
  );

  // Generate the ZIP file.
  const zip_blob = await zip.generateAsync({
    type: "blob",
  });

  // Download the complete production configuration.
  const download_link = document.createElement("a");

  download_link.href = URL.createObjectURL(zip_blob);
  download_link.download = "event-config-production.zip";

  document.body.appendChild(download_link);
  download_link.click();
  download_link.remove();

  // Release the temporary object URL.
  setTimeout(() => {
    URL.revokeObjectURL(download_link.href);
  }, 1000);
}

function normalizeVersion(value){const s=String(value||"1");return s.includes(".")?s:(s+".0");}

// Browser History API routes: /, /experiments/:id/configuration, /experiments/:id/simulation.
function routeForExperiment(id, tab) {
  return "/experiments/" + encodeURIComponent(id || "new") + "/" + (tab || "configuration");
}
function navigateTo(path) {
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
}
function renderRoute(pathname) {
  const path = pathname || window.location.pathname || "/";
  if (path === "/" || path === "/index.html") {
    document.getElementById("home_page").classList.add("active");
    document.getElementById("detail_page").classList.remove("active");
    render();
    return;
  }
  const match = path.match(/^\/experiments\/([^/]+)\/(configuration|simulation)\/?$/);
  if (!match) {
    window.history.replaceState({}, "", "/");
    renderRoute("/");
    return;
  }
  const id = decodeURIComponent(match[1]);
  const tab = match[2];
  if (id === "new") {
    if (!newExperimentInitialized) setupNewExperiment();
    document.getElementById("home_page").classList.remove("active");
    document.getElementById("detail_page").classList.add("active");
    showDetailTab(tab, false);
    return;
  }
  const exp = experiments.find(item => item.id === id);
  if (!exp) {
    window.history.replaceState({}, "", "/");
    renderRoute("/");
    return;
  }
  // When only the tab changes, preserve any unsaved form edits in the DOM.
  if (editingId === id && document.getElementById("detail_page").classList.contains("active")) {
    showDetailTab(tab, false);
    return;
  }
  renderExperimentPage(exp, tab);
}
function confirmDiscardUnsavedDuplicate(targetExperimentId = null) {
  const duplicateId = editingId;
  // Only check experiments that were duplicated but not saved.
  if (
    !duplicateId ||
    !unsavedExperimentIds.has(duplicateId) ||
    targetExperimentId === duplicateId
  ) {
    return true;
  }
  const confirmed = confirm(
    "This duplicated experiment has not been saved.\n\n" +
    "If you leave this page, the duplicated experiment and its unsaved data will be discarded.\n\n" +
    "Do you want to leave without saving?"
  );
  // User chooses Cancel.
  if (!confirmed) {
    return false;
  }
  // User chooses OK: remove the duplicate from memory.
  experiments = experiments.filter(
    item => item.id !== duplicateId
  );
  unsavedExperimentIds.delete(duplicateId);
  if (selectedPreviewId === duplicateId) {
    selectedPreviewId = null;
  }
  editingId = null;
  return true;
}
function showHome(pushRoute = true) {
  // Check whether the current duplicate is still unsaved.
  if (!confirmDiscardUnsavedDuplicate()) {
    return;
  }
  if (pushRoute) {
    navigateTo("/");
  }
  document.getElementById("home_page").classList.add("active");
  document.getElementById("detail_page").classList.remove("active");
  render();
}
function showDetailTab(tab, pushRoute = true){
  if(contextJsonEditing)cancelContextJson();
  detailTab=tab;
  if (pushRoute) navigateTo(routeForExperiment(editingId || "new", tab));
  document.getElementById("configuration_view").classList.toggle("hidden",tab!=="configuration");
  document.getElementById("simulation_view").classList.toggle("hidden",tab!=="simulation");
  document.getElementById("configuration_tab").classList.toggle("active",tab==="configuration");
  document.getElementById("simulation_tab").classList.toggle("active",tab==="simulation");
  document.getElementById("breadcrumb_tab").textContent=tab==="configuration"?"Configuration":"Simulation";
  if(tab==="simulation")renderSimulationContext();
}
function renderExperimentPage(exp, tab) {
  editExperiment(exp.id);
  document.getElementById("home_page").classList.remove("active");
  document.getElementById("detail_page").classList.add("active");
  document.getElementById("detail_title").textContent=exp.name;
  document.getElementById("breadcrumb_name").textContent=exp.name;
  document.getElementById("detail_status").className="status "+exp.status;
  document.getElementById("detail_status").textContent=exp.status[0].toUpperCase()+exp.status.slice(1);
  document.getElementById("saved_version").textContent="Saved configuration · v"+normalizeVersion(exp.version);
  document.getElementById("simulation_id").value=exp.id;
  showDetailTab(tab, false);
}
function openExperiment(id,tab="configuration",pushRoute=true){
  const exp=experiments.find(x=>x.id===id);
  if(!exp)return;
  if (pushRoute) navigateTo(routeForExperiment(id, tab));
  renderExperimentPage(exp, tab);
}
window.addEventListener("popstate", () => {
  const targetPath = window.location.pathname;
  // Identify the experiment in the destination route.
  const match = targetPath.match(
    /^\/experiments\/([^/]+)\/(configuration|simulation)\/?$/
  );
  const targetId = match
    ? decodeURIComponent(match[1])
    : null;
  // Check before rendering the destination page.
  if (!confirmDiscardUnsavedDuplicate(targetId)) {
    // Cancel navigation and restore the current duplicate URL.
    window.history.pushState(
      {},
      "",
      routeForExperiment(editingId, detailTab)
    );
    return;
  }
  // Continue navigation after confirmation.
  renderRoute(targetPath);
});
let contextJsonEditing = false;
function toggleContextJson(){
  const fields = document.getElementById("simulation_context_fields");
  const custom = document.getElementById("simulation_context_custom");
  const editor = document.getElementById("context_json_editor");
  const button = document.getElementById("context_json_toggle");
  if (contextJsonEditing) {
    cancelContextJson();
    return;
  }
  syncSimulationContext();
  document.getElementById("context_json_text").value = JSON.stringify(
    JSON.parse(document.getElementById("context").value || "{}"), null, 2
  );
  document.getElementById("context_json_error").textContent = "";
  fields.classList.add("hidden");
  custom.classList.add("hidden");
  editor.classList.remove("hidden");
  button.textContent = "Use input fields";
  contextJsonEditing = true;
}
function cancelContextJson(){
  document.getElementById("context_json_editor").classList.add("hidden");
  document.getElementById("simulation_context_fields").classList.remove("hidden");
  document.getElementById("simulation_context_custom").classList.remove("hidden");
  document.getElementById("context_json_toggle").textContent = "Edit as JSON";
  document.getElementById("context_json_error").textContent = "";
  contextJsonEditing = false;
}
function applyContextJson(){
  const errorBox = document.getElementById("context_json_error");
  try {
    const parsed = JSON.parse(document.getElementById("context_json_text").value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The JSON root must be an object.");
    }
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key.trim()) throw new Error("Context keys cannot be empty.");
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        throw new Error('Context value for "' + key + '" must be a string, number, boolean, or null.');
      }
    });
    const normalized = {};
    Object.entries(parsed).forEach(([key, value]) => {
      normalized[key] = value == null ? "" : String(value);
    });
    document.getElementById("context").value = JSON.stringify(normalized);
    renderSimulationContext(normalized);
    cancelContextJson();
  } catch (error) {
    errorBox.textContent = "Invalid request context JSON: " + error.message;
  }
}
function renderSimulationContext(contextValues){
  const exp=experiments.find(x=>x.id===document.getElementById("simulation_id").value);
  const target=exp?.target||{};
  let context = contextValues;
  if (!context) {
    try { context = JSON.parse(document.getElementById("context").value || "{}"); }
    catch (_) { context = {}; }
  }
  const box=document.getElementById("simulation_context_fields");
  const customBox=document.getElementById("simulation_context_custom");
  const customKeys=[...new Set([...Object.keys(target).filter(k=>!DEFAULT_TARGETS.includes(k)), ...Object.keys(context).filter(k=>!DEFAULT_TARGETS.includes(k))])];
  box.innerHTML=DEFAULT_TARGETS.map(key=>`<div class="input-container"><label>${key[0].toUpperCase()+key.slice(1)} *</label><input class="sim-context" data-key="${key}" value="${escapeHtml(context[key] ?? target[key] ?? "")}" placeholder="${key}"></div>`).join("");
  customBox.innerHTML=customKeys.map(k=>simulationCustomRow(k,context[k] ?? "")).join("");
  document.querySelectorAll("#simulation_context_fields input, #simulation_context_custom input").forEach(i=>i.addEventListener("input",syncSimulationContext));
  syncSimulationContext();
}
function simulationCustomRow(key="", value=""){
  return `<div class="context-custom-row"><div class="input-container"><label>Target key</label><input class="sim-context-key" value="${escapeHtml(key)}" placeholder="e.g. section" oninput="syncSimulationContext()"></div><div class="input-container"><label>Value</label><input class="sim-context custom-context-value" value="${escapeHtml(value)}" placeholder="Enter value" oninput="syncSimulationContext()"></div><button class="btn context-remove" type="button" title="Remove target" aria-label="Remove target" onclick="removeSimulationTarget(this)">×</button></div>`;
}
function addSimulationTarget(){
  if(contextJsonEditing) cancelContextJson();
  const box=document.getElementById("simulation_context_custom");
  box.insertAdjacentHTML("beforeend",simulationCustomRow("",""));
  const inputs=box.querySelectorAll(".sim-context-key");
  if(inputs.length) inputs[inputs.length-1].focus();
  syncSimulationContext();
}
function removeSimulationTarget(button){
  button.closest(".context-custom-row")?.remove();
  syncSimulationContext();
}
function syncSimulationContext(){
  const context={};
  document.querySelectorAll("#simulation_context_fields .sim-context").forEach(i=>context[i.dataset.key]=i.value.trim());
  document.querySelectorAll("#simulation_context_custom .context-custom-row").forEach(row=>{
    const key=row.querySelector(".sim-context-key")?.value.trim();
    const value=row.querySelector(".custom-context-value")?.value.trim() ?? "";
    if(key) context[key]=value;
  });
  document.getElementById("context").value=JSON.stringify(context);
}
function runSimulationTest(type){document.querySelectorAll(".test-actions .btn").forEach(b=>b.classList.remove("active"));const id={distribution:"run_distribution_btn",inspect:"inspect_btn",consistency:"consistency_btn"}[type];document.getElementById(id).classList.add("active");if(type==="distribution")distribution();if(type==="inspect")inspect();if(type==="consistency")consistency();}
function renderSimulationVisual(type,data){const box=document.getElementById("simulation_visual_results");if(type==="distribution"&&data.actual){const entries=Object.entries(data.actual);box.innerHTML=`<div class="result-grid">${entries.map(([name,v])=>`<div><div class="muted">${escapeHtml(name==="__unassigned"?"Unassigned":name)}</div><div class="result-number">${v.count.toLocaleString()} users</div><div class="muted">${v.percentage}% observed</div></div>`).join("")}</div><div class="result-bar">${entries.map(([name,v])=>{const modelIndex=(data.expected||[]).findIndex(x=>x.model===name);const color=name==="__unassigned"?"#e5e7eb":MODEL_COLORS[Math.max(0,modelIndex)%MODEL_COLORS.length];return `<span title="${escapeHtml(name==="__unassigned"?"Unassigned":name)} · ${v.percentage}%" style="width:${v.percentage}%;background:${color}"></span>`;}).join("")}</div><div class="result-foot"><span>Observed allocation</span><span>Configured allocation: ${data.expected.map(x=>x.percentage).join(" / ")}</span></div>`;document.getElementById("result_title").textContent="Distribution results";document.getElementById("result_subtitle").textContent=`Illustrative preview · ${document.getElementById("total_users").value} simulated users`;}else if(type==="inspect"){box.innerHTML=`<div class="aside-card"><div class="muted">Assignment result for user ${escapeHtml(data.userId)}</div><div class="result-number">${escapeHtml(data.assignedModel||"Unassigned")}</div><div class="${data.targetMatches?'success':'error'}">${data.targetMatches?'Context matches audience rules':'Context does not match audience rules'}</div><div class="muted">Bucket ${data.bucket} · ${data.assignmentStatus}</div></div>`;document.getElementById("result_title").textContent="User inspection";document.getElementById("result_subtitle").textContent="Deterministic assignment for the supplied user ID";}else if(type==="consistency"){box.innerHTML=`<div class="aside-card"><div class="result-number">${data.passed?'Consistent':'Inconsistent'}</div><div class="${data.passed?'success':'error'}">${data.passed?'The same request returned the same assignment hash and bucket.':'Assignment results differed between repeated requests.'}</div></div>`;document.getElementById("result_title").textContent="Consistency results";document.getElementById("result_subtitle").textContent="Repeated assignment check";}}
function updateAllocationVisual(){
  const models=currentModels();
  const total=models.reduce((s,m)=>s+(Number(m.percentage)||0),0);
  const remaining=Math.max(0,100-total);
  const scale=total>100?100/total:1;
  const segments=models.map((m,i)=>({
    name:m.name,
    percentage:Math.max(0,Number(m.percentage)||0),
    width:Math.max(0,Number(m.percentage)||0)*scale,
    color:MODEL_COLORS[i%MODEL_COLORS.length]
  }));
  document.getElementById("model_allocation_bar").innerHTML=
    segments.map(m=>`<span title="${escapeHtml(m.name)} · ${m.percentage}%" style="width:${m.width}%;background:${m.color}"></span>`).join("")+
    (total<=100?`<span title="Unassigned · ${remaining.toFixed(2)}%" style="width:${remaining}%;background:#e5e7eb"></span>`:"");
  document.getElementById("model_allocation_legend").innerHTML=
    segments.map(m=>`<span><i class="dot" style="background:${m.color}"></i>${escapeHtml(m.name)} ${m.percentage}%</span>`).join("")+
    (remaining>0?`<span><i class="dot" style="background:#e5e7eb"></i>Unassigned ${remaining.toFixed(2)}%</span>`:"");
}
async function hash(s) {
  if (!window.AnalyticModelSDK || !AnalyticModelSDK._test || !AnalyticModelSDK._test.sha256) {
    throw new Error("Analytic Model SDK is not available. Check the SDK CDN connection and reload the page.");
  }
  return AnalyticModelSDK._test.sha256(s);
}
async function distribution() {
  const exp_data = experiments.find(
      (exp_item) => exp_item.id === document.getElementById("simulation_id").value,
    ),
    user_total_number = Number(document.getElementById("total_users").value);
  if (!exp_data) {
    document.getElementById("simulation_output").textContent = "Experiment not found";
    return;
  }
  if (!Number.isInteger(user_total_number) || user_total_number < 1) { document.getElementById("simulation_output").textContent="Number of users must be at least 1"; return; }
  if (!exp_data.models || exp_data.models.length < 2) {
    document.getElementById("simulation_output").textContent = "No valid models";
    return;
  }
  const user_distribution = {};
  let user_unassigned = 0;
  exp_data.models.forEach((model_item) => (user_distribution[model_item.name] = 0));
  for (let i = 1; i <= user_total_number; i++) {
    const bucket_value = AnalyticModelSDK._test.bucket(
      await hash(exp_data.id + ":sim_user_" + i),
    );
    const model_data = AnalyticModelSDK._test.select(exp_data.models, bucket_value);

    // A null model means this user falls into the unassigned
    // percentage because the configured model total is below 100%.
    if (model_data) {
      user_distribution[model_data.name]++;
    } else {
      user_unassigned++;
    }
  }
  user_distribution["__unassigned"] = user_unassigned;
  document.getElementById("simulation_output").textContent = JSON.stringify(
    {
      expected: [
        ...exp_data.models.map((model_item) => ({
          model: model_item.name,
          percentage: model_item.percentage,
        })),
        {
          model: "__unassigned",
          percentage: Math.max(0, 100 - exp_data.models.reduce(
            (total, model_item) => total + Number(model_item.percentage || 0),
            0,
          )),
        },
      ],
      actual: Object.fromEntries(
        Object.entries(user_distribution).map((x) => [
          x[0],
          { count: x[1], percentage: ((x[1] / user_total_number) * 100).toFixed(2) },
        ]),
      ),
    },
    null,
    2,
  );
  const result=JSON.parse(document.getElementById("simulation_output").textContent); renderSimulationVisual("distribution",result);
}
async function inspect() {
  const exp_data = experiments.find(
    (exp_item) => exp_item.id === document.getElementById("simulation_id").value,
  );
  if (!exp_data) {
    document.getElementById("simulation_output").textContent = "Experiment not found";
    return;
  }
  if (!document.getElementById("simulation_user_id").value.trim()) { document.getElementById("simulation_output").textContent="User ID is required"; return; }
  const hash_value = await hash(exp_data.id + ":" + document.getElementById("simulation_user_id").value),
    bucket_value = AnalyticModelSDK._test.bucket(hash_value),
    model_item = AnalyticModelSDK._test.select(exp_data.models, bucket_value);
  document.getElementById("simulation_output").textContent = JSON.stringify(
    {
      experimentId: exp_data.id,
      userId: document.getElementById("simulation_user_id").value,
      hash: hash_value,
      bucket: bucket_value,
      assignedModel: model_item ? model_item.name : null,
      assignmentStatus: model_item ? "assigned" : "unassigned",
      targetMatches: AnalyticModelSDK._test.targetMatches(
        exp_data.target,
        JSON.parse(document.getElementById("context").value),
      ),
    },
    null,
    2,
  );
  renderSimulationVisual("inspect",JSON.parse(document.getElementById("simulation_output").textContent));
}
async function consistency() {
  const exp_data = experiments.find(
    (exp_item) => exp_item.id === document.getElementById("simulation_id").value,
  );
  if (!exp_data) {
    document.getElementById("simulation_output").textContent = "Experiment not found";
    return;
  }
  const consistency_data = [];
  for (let i = 0; i < 20; i++) {
    const hash_value = await hash(
      exp_data.id + ":" + document.getElementById("simulation_user_id").value,
    );
    consistency_data.push([hash_value, AnalyticModelSDK._test.bucket(hash_value)]);
  }
  document.getElementById("simulation_output").textContent = JSON.stringify(
    {
      passed: consistency_data.every((x) => x[0] === consistency_data[0][0] && x[1] === consistency_data[0][1]),
      sample: consistency_data[0],
    },
    null,
    2,
  );
  renderSimulationVisual("consistency",JSON.parse(document.getElementById("simulation_output").textContent));
}
// Close dropdown when clicking outside
loadConfiguration().then(() => renderRoute(window.location.pathname));
