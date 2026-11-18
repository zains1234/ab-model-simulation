(function () {
  "use strict";

  // Browser-only temporary workspace. The CDN remains the published source of truth.
  var STORAGE_KEY = "abtest-dashboard-temp-workspace-v1";
  var DRAFTS_KEY = "abtest-dashboard-temp-drafts-v1";

  function readStore() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        version: 1,
        records: Array.isArray(parsed.records) ? parsed.records : []
      };
    } catch (error) {
      throw new Error("Temporary workspace data is invalid. Export or clear the browser's local storage before continuing.");
    }
  }

  function writeStore(records) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        updated_at: new Date().toISOString(),
        records: records
      }));
    } catch (error) {
      if (error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
        throw new Error("Browser storage is full. Export your temporary configuration and clear unused temporary changes.");
      }
      throw error;
    }
  }

  function readDrafts() {
    try {
      var parsed = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeDrafts(drafts) {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function cleanForExport(experiment) {
    var data = window.cloneData(experiment || {});
    delete data.__workspaceSource;
    delete data.__workspaceBaseName;
    delete data.__workspaceKind;
    return data;
  }

  function markTemp(data, baseName, kind) {
    var result = window.cloneData(data);
    result.__workspaceSource = "temp";
    result.__workspaceBaseName = baseName || result.name;
    result.__workspaceKind = kind || "update";
    return result;
  }

  function merge(cdnExperiments) {
    var result = (cdnExperiments || []).map(function (item) {
      var copy = window.cloneData(item);
      copy.__workspaceSource = "cdn";
      copy.__workspaceBaseName = copy.name;
      copy.__workspaceKind = "cdn";
      return copy;
    });
    var records = readStore().records;

    records.forEach(function (record) {
      var baseName = normalizeName(record.baseName);
      var index = baseName ? result.findIndex(function (item) {
        return normalizeName(item.name) === baseName;
      }) : -1;

      if (record.kind === "delete") {
        if (index >= 0) result.splice(index, 1);
        return;
      }

      if (!record.data) return;
      var replacement = markTemp(record.data, record.baseName || record.data.name, record.kind);
      if (index >= 0) result.splice(index, 1, replacement);
      else if (!result.some(function (item) { return normalizeName(item.name) === normalizeName(replacement.name); })) {
        result.push(replacement);
      }
    });

    return result;
  }

  function findRecord(records, baseName, dataName, kind) {
    var baseKey = normalizeName(baseName);
    var dataKey = normalizeName(dataName);
    return records.findIndex(function (record) {
      if (kind === "create") {
        var storedName = normalizeName(record.data && record.data.name);
        return record.kind === "create" && (storedName === dataKey || (baseKey && storedName === baseKey));
      }
      return !!baseKey && normalizeName(record.baseName) === baseKey;
    });
  }

  window.TempWorkspace = {
    storageKey: STORAGE_KEY,
    draftsKey: DRAFTS_KEY,
    merge: merge,
    cleanForExport: cleanForExport,
    isTemp: function (experiment) {
      return !!experiment && experiment.__workspaceSource === "temp";
    },
    save: function (experiment, kind, baseName) {
      var records = readStore().records;
      var clean = cleanForExport(experiment);
      var recordKind = kind === "create" ? "create" : "update";
      var recordBaseName = baseName || experiment.__workspaceBaseName || experiment.name;
      var originalName = recordKind === "create" ? "" : recordBaseName;
      var index = findRecord(records, recordBaseName, clean.name, recordKind);
      var record = {
        kind: recordKind,
        baseName: originalName || null,
        data: clean,
        saved_at: new Date().toISOString()
      };
      if (index >= 0) {
        if (records[index].kind === "create") record.kind = "create";
        if (records[index].kind === "create") record.baseName = null;
        records[index] = record;
      } else records.push(record);
      writeStore(records);
      return markTemp(clean, record.baseName || clean.name, record.kind);
    },
    saveDraft: function (draft) {
      var drafts = readDrafts();
      var key = normalizeName(draft.data && draft.data.name);
      var index = drafts.findIndex(function (item) { return normalizeName(item.data && item.data.name) === key; });
      if (index >= 0) drafts[index] = draft;
      else drafts.push(draft);
      writeDrafts(drafts);
    },
    getDraft: function (name) {
      var key = normalizeName(name);
      return readDrafts().find(function (item) { return normalizeName(item.data && item.data.name) === key; }) || null;
    },
    removeDraft: function (name) {
      var key = normalizeName(name);
      writeDrafts(readDrafts().filter(function (item) { return normalizeName(item.data && item.data.name) !== key; }));
    },
    clear: function () {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(DRAFTS_KEY);
    },
    count: function () {
      return readStore().records.length;
    },
    draftCount: function () {
      return readDrafts().length;
    }
  };
})();
