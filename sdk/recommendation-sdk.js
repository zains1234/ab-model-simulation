(function (w) {
  "use strict";

  // Main SDK object and runtime state.
  var S = {
    version: "1.1.0",
    ready: null,
    state: { status: "idle", assignment: null, debug: {} },
  };

  // Returns true when the user ID is missing or still contains an
  // unresolved GTM variable such as {{User ID}}.
  function unresolved(v) {
    return (
      v == null ||
      !String(v).trim() ||
      /^\{\{[^}]+\}\}$/.test(String(v).trim())
    );
  }

  // Deep-clone JSON-compatible values before exposing or modifying them.
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  // Checks whether all configured experiment target fields match the
  // runtime context supplied by GTM.
  function match(target, ctx) {
    return Object.keys(target || {}).every(function (k) {
      return ctx[k] != null && String(ctx[k]) === String(target[k]);
    });
  }

  // Finds conflicting active experiments that control the same
  // experiment-based recommendation key.
  function conflicts(xs) {
    var o = {},
      out = [];

    xs.forEach(function (e) {
      Object.keys(e.recommendations || {}).forEach(function (k) {
        var c = e.recommendations[k];
        if (c && c.type === "experiment") {
          (o[k] || (o[k] = [])).push(e.id);
        }
      });
    });

    Object.keys(o).forEach(function (k) {
      if (o[k].length > 1) {
        out.push({ key: k, experiments: o[k] });
      }
    });

    return out;
  }

  // Validates the model list.
  // The total may now be LESS than 100%.
  // Any remaining percentage represents users who are not assigned
  // to a model.
  function validateModels(ms) {
    if (!Array.isArray(ms) || ms.length < 2) {
      throw Error("At least 2 models required");
    }

    var t = 0,
      n = {};

    ms.forEach(function (m) {
      if (!m.name || n[m.name]) {
        throw Error("Model names must be unique");
      }

      n[m.name] = 1;

      if (
        !Number.isFinite(Number(m.percentage)) ||
        Number(m.percentage) < 0
      ) {
        throw Error("Invalid percentage for model " + m.name);
      }

      t += Number(m.percentage);
    });

    // Model coverage can be partial, but cannot exceed 100%.
    // Example: 40% + 40% = 80%, so 20% remains unassigned.
    if (t <= 0) {
      throw Error("Model percentages must be greater than 0% in total");
    }

    if (t > 100 + 1e-9) {
      throw Error("Model percentages must not exceed 100%");
    }
  }

  // Validates either a static recommendation or an experiment
  // recommendation.
  function validateRecommendation(c, ms) {
    if (!c || typeof c !== "object") {
      throw Error("Invalid recommendation");
    }

    // Static recommendations do not participate in model assignment.
    if (c.type === "static") {
      if (!String(c.url || "").trim()) {
        throw Error("Static recommendation URL is required");
      }

      if (!String(c.tracking_rec || "").trim()) {
        throw Error("Static recommendation tracking_rec is required");
      }

      return;
    }

    // Experiment recommendations must have configuration for every model.
    if (
      c.type === "experiment" &&
      c.models &&
      typeof c.models === "object"
    ) {
      ms.forEach(function (m) {
        var r = c.models[m.name];

        if (!r || !String(r.url || "").trim()) {
          throw Error("Missing URL for " + m.name);
        }

        if (!String(r.tracking_rec || "").trim()) {
          throw Error("Missing tracking_rec for " + m.name);
        }
      });

      return;
    }

    throw Error("Invalid recommendation type");
  }

  // Select a model using the 0-99 assignment bucket and cumulative
  // percentages.
  //
  // Example: modelA=50, modelB=30
  // 0-49 -> modelA
  // 50-79 -> modelB
  // 80-99 -> no model / unassigned
  function select(ms, b) {
    var x = 0;

    for (var i = 0; i < ms.length; i++) {
      x += Number(ms[i].percentage);

      if (b < x) {
        return ms[i];
      }
    }

    // The bucket is outside the configured model coverage.
    // This is expected when model percentages total less than 100%.
    return null;
  }

  // Creates a SHA-256 hash used for deterministic assignment.
  async function sha256(s) {
    var b = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(s),
    );

    return Array.from(new Uint8Array(b))
      .map(function (x) {
        return x.toString(16).padStart(2, "0");
      })
      .join("");
  }

  // Converts the first part of the SHA-256 hash into a bucket 0-99.
  function bucket(h) {
    return parseInt(h.slice(0, 8), 16) % 100;
  }

  // Loads JSON configuration from the CDN.
  async function get(url) {
    var r = await fetch(url);

    if (!r.ok) {
      throw Error("HTTP " + r.status + " loading " + url);
    }

    return r.json();
  }

  // Builds window.dsrec from the selected experiment.
  // Static recommendations are always included when an experiment matches.
  // Experiment recommendations are included only when a model was assigned.
  function build(exp, chosen) {
    var out = {};

    if (exp) {
      Object.keys(exp.recommendations || {}).forEach(function (k) {
        var c = exp.recommendations[k];

        // Static recommendation: does not depend on the assigned model.
        if (c && c.type === "static") {
          var staticValue = clone(c);
          delete staticValue.type;
          out[k] = staticValue;
          return;
        }

        // Experiment recommendation: use the selected model.
        if (c && c.type === "experiment") {
          var m = chosen[k];

          // No assigned model means this recommendation is excluded
          // for this user.
          if (!m) {
            return;
          }

          var selected = c.models[m.name];

          if (!selected) {
            throw Error(
              "Selected model " +
                m.name +
                " is missing from recommendation " +
                k,
            );
          }

          out[k] = clone(selected);
        }
      });
    }

    return out;
  }

  // Initializes the SDK, loads active experiments, resolves targeting,
  // performs deterministic assignment, and builds window.dsrec.
  S.init = async function (o) {
    if (S.ready) return S.ready;

    S.ready = (async function () {
      try {
        if (!o || !o.configUrl) {
          throw Error("configUrl is required");
        }

        var ctx = o.context || {},
          man = await get(o.configUrl);

        if (man.schema_version !== 2) {
          throw Error("Unsupported schema version: " + man.schema_version);
        }

        var list = [];

        // Load and validate all active experiments from the manifest.
        for (var i = 0; i < (man.experiments || []).length; i++) {
          var e0 = man.experiments[i];

          if (e0.status !== "active") continue;

          var e = await get(new URL(e0.config_url, o.configUrl));

          if (e.schema_version !== 2) {
            throw Error(
              "Unsupported experiment schema version: " +
                e.schema_version,
            );
          }

          validateModels(e.models);

          Object.keys(e.recommendations || {}).forEach(function (k) {
            validateRecommendation(e.recommendations[k], e.models);
          });

          if (e.status === "active" && match(e.target, ctx)) {
            list.push(e);
          }
        }

        // Never randomly choose between conflicting experiments.
        var cs = conflicts(list);

        if (cs.length) {
          S.state.status = "conflict";
          w.dsrecExperiment = {
            status: "conflict",
            conflicts: cs,
          };
          throw Error("Conflicting active experiments");
        }

        // Without a valid user ID there is no deterministic assignment.
        if (unresolved(o.userId)) {
          w.dsrec = build(null, {});
          S.state.status = "no_user_id";
          w.dsrecExperiment = { status: "no_user_id" };
          return;
        }

        // Only one matching experiment should remain after conflict checks.
        var e = list[0];

        if (!e) {
          w.dsrec = build(null, {});
          S.state.status = "no_matching_experiment";
          w.dsrecExperiment = { status: S.state.status };
          return;
        }

        // Experiment ID + user ID creates an experiment-specific deterministic
        // assignment. The same user can therefore be assigned differently
        // in different experiments.
        var h = await sha256(e.id + ":" + String(o.userId)),
          b = bucket(h),
          chosen = {},
          assigned = null;

        // Select one model for all experiment recommendation keys.
        Object.keys(e.recommendations || {}).forEach(function (k) {
          var c = e.recommendations[k];

          if (c.type === "experiment") {
            var m = select(e.models, b);

            // null means the bucket is outside the configured model coverage.
            if (m) {
              chosen[k] = m;

              if (assigned === null) {
                assigned = m.name;
              }
            }
          }
        });

        // Build the final frontend object.
        // Static recommendations may still be present even when the user
        // is outside the model allocation. Experiment recommendations are not.
        w.dsrec = build(e, chosen);

        // Record whether this user received a model or falls into the
        // intentionally unassigned percentage.
        if (assigned === null) {
          S.state.assignment = {
            status: "unassigned",
            experimentId: e.id,
            experimentVersion: e.version,
            hash: h,
            bucket: b,
            assignedModel: null,
          };

          S.state.status = "unassigned";
        } else {
          S.state.assignment = {
            status: "assigned",
            experimentId: e.id,
            experimentVersion: e.version,
            hash: h,
            bucket: b,
            assignedModel: assigned,
          };

          S.state.status = "assigned";
        }

        S.state.debug = {
          status: S.state.status,
          context: clone(ctx),
          assignment: clone(S.state.assignment),
        };

        w.dsrecExperiment = clone(S.state.debug);

        // Only send the assignment event when a model was actually assigned.
        // Unassigned users are intentionally not counted as model assignments.
        if (w.dataLayer && assigned !== null) {
          w.dataLayer.push({
            event: "recommendation_model_assigned",
            experiment_id: e.id,
            experiment_version: e.version,
            assigned_model: assigned,
            bucket: b,
          });
        }
      } catch (err) {
        S.state.status = "error";
        S.state.error = err.message;
        w.dsrecExperiment = {
          status: "error",
          message: err.message,
        };
      } finally {
        S.state.ready = true;
      }

      return S.getDebugInfo();
    })();

    return S.ready;
  };

  // Returns the deterministic assignment information.
  S.getAssignment = function () {
    return clone(S.state.assignment);
  };

  // Returns the final recommendation configuration consumed by the frontend.
  S.getConfig = function () {
    return w.dsrec ? clone(w.dsrec) : null;
  };

  // Returns the SDK state for debugging.
  S.getDebugInfo = function () {
    return clone(S.state);
  };

  // Internal utilities used by the dashboard simulation and automated tests.
  S._test = {
    sha256: sha256,
    bucket: bucket,
    select: select,
    targetMatches: match,
    findConflicts: conflicts,
    validateModels: validateModels,
  };

  // Expose the SDK globally.
  w.RecommendationSDK = S;
})(window);
