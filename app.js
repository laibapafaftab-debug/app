(() => {
  "use strict";

  const TOKEN_KEY = "leaddesk_token";
  const FILTERS = [
    { key: "all", label: "All", count: "total" },
    { key: "High", label: "High", count: "high" },
    { key: "Medium", label: "Medium", count: "medium" },
    { key: "Low", label: "Low", count: "low" },
    { key: "Unscored", label: "Not analyzed", count: "unscored" },
  ];

  const state = { leads: [], summary: null, filter: "all" };

  const $ = (selector) => document.querySelector(selector);
  const dom = {
    banner: $("#banner"),
    form: $("#inquiry-form"),
    message: $("#f-message"),
    counter: $("#message-count"),
    submit: $("#submit-btn"),
    formMsg: $("#form-msg"),
    filters: $("#filters"),
    list: $("#lead-list"),
    empty: $("#empty"),
    gate: $("#gate"),
    gateForm: $("#gate-form"),
    gateToken: $("#gate-token"),
    gateMsg: $("#gate-msg"),
    refresh: $("#refresh-btn"),
    detail: $("#detail"),
    detailBody: $("#detail-body"),
    theme: $("#theme-toggle"),
  };

  /* ---------- helpers ---------- */

  // Build DOM with textContent only, so lead data is never parsed as HTML.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  }

  const getToken = () => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  };
  const setToken = (token) => {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* storage unavailable */ }
  };

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
    }
    if (res.status === 204) return null;

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }

    if (!res.ok) {
      let message = "Something went wrong. Try again.";
      if (data && typeof data.detail === "string") {
        message = data.detail;
      } else if (data && Array.isArray(data.detail)) {
        const fields = [...new Set(data.detail.map((d) => d.loc && d.loc[d.loc.length - 1]).filter(Boolean))];
        message = fields.length ? `Check these fields: ${fields.join(", ")}.` : "Check the form and try again.";
      }
      throw new ApiError(message, res.status);
    }
    return data;
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  function timeAgo(iso) {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return "";
    const seconds = Math.round((then.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 45) return "just now";
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
    if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), "day");
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const fullDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  const levelOf = (lead) => (lead.intent ? lead.intent.toLowerCase() : "none");
  const intentText = (lead) => (lead.intent ? `${lead.intent} intent` : "Not analyzed");

  function meter(level, label) {
    return el("span", { class: "meter", "data-level": level, role: "img", "aria-label": label }, el("i"), el("i"), el("i"));
  }

  function setMessage(node, text, kind) {
    node.textContent = text || "";
    node.className = `form-msg${kind ? " " + kind : ""}`;
  }

  function flash(button, label) {
    const original = button.textContent;
    button.textContent = label;
    setTimeout(() => { button.textContent = original; }, 1600);
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      flash(button, "Copied");
    } catch {
      const area = el("textarea", { class: "sr-only", "aria-hidden": "true" });
      area.value = text;
      document.body.append(area);
      area.select();
      try {
        document.execCommand("copy");
        flash(button, "Copied");
      } catch {
        flash(button, "Copy failed");
      }
      area.remove();
    }
  }

  /* ---------- list ---------- */

  function renderFilters() {
    const summary = state.summary || {};
    dom.filters.replaceChildren(
      ...FILTERS
        .filter((f) => f.key !== "Unscored" || summary.unscored > 0 || state.filter === "Unscored")
        .map((f) =>
          el(
            "button",
            {
              class: "chip",
              type: "button",
              "aria-pressed": String(state.filter === f.key),
              onclick: () => {
                state.filter = f.key;
                loadAll();
              },
            },
            f.label,
            el("span", { class: "chip-count" }, String(summary[f.count] ?? 0))
          )
        )
    );
  }

  function leadRow(lead) {
    const level = levelOf(lead);
    const preview = lead.summary || (lead.message.length > 140 ? lead.message.slice(0, 140) + "…" : lead.message);
    return el(
      "li",
      {},
      el(
        "button",
        { class: "lead", type: "button", onclick: () => openLead(lead) },
        el("div", { class: "lead-meter" }, meter(level, intentText(lead))),
        el(
          "div",
          { class: "lead-main" },
          el("div", { class: "lead-name" }, lead.name, lead.company ? el("span", { class: "lead-company" }, ` · ${lead.company}`) : null),
          el("div", { class: "lead-summary" }, preview)
        ),
        el(
          "div",
          { class: "lead-meta" },
          el("span", { class: "intent-label", "data-level": level }, intentText(lead)),
          el("span", { title: fullDate(lead.created_at) }, timeAgo(lead.created_at)),
          el("span", { class: "pill", "data-status": lead.status }, lead.status)
        )
      )
    );
  }

  function renderList() {
    dom.list.replaceChildren(...state.leads.map(leadRow));
    if (state.leads.length === 0) {
      dom.empty.textContent =
        state.filter === "all"
          ? "No leads yet. Submit an inquiry and it will appear here."
          : "No leads match this filter.";
      dom.empty.hidden = false;
    } else {
      dom.empty.hidden = true;
    }
  }

  function setLocked(locked) {
    dom.gate.hidden = !locked;
    dom.filters.hidden = locked;
    dom.list.hidden = locked;
    dom.refresh.hidden = locked;
    if (locked) dom.empty.hidden = true;
  }

  // Returns true when the dashboard data loaded.
  async function loadAll() {
    try {
      const query = state.filter === "all" ? "" : `?intent=${encodeURIComponent(state.filter)}`;
      const [summary, data] = await Promise.all([api("/api/summary"), api(`/api/leads${query}`)]);
      state.summary = summary;
      state.leads = data.leads;
      setLocked(false);
      renderFilters();
      renderList();
      return true;
    } catch (err) {
      if (err.status === 401) {
        setLocked(true);
        return false;
      }
      dom.empty.textContent = err.message;
      dom.empty.hidden = false;
      return false;
    }
  }

  /* ---------- detail sheet ---------- */

  function detailItem(label, value) {
    return [
      el("dt", {}, label),
      el("dd", value ? { text: value } : { class: "none", text: "Not stated" }),
    ];
  }

  function openLead(lead) {
    renderDetail(lead);
    if (!dom.detail.open) dom.detail.showModal();
  }

  function renderDetail(lead) {
    const level = levelOf(lead);
    const subject = lead.follow_up_subject || "";
    const body = lead.follow_up_body || "";
    const hasDraft = Boolean(subject || body);
    const mailto =
      `mailto:${encodeURIComponent(lead.email)}` +
      `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    const head = el(
      "div",
      { class: "sheet-head" },
      el(
        "div",
        {},
        el("h3", { id: "detail-title" }, lead.name),
        el(
          "p",
          { class: "sheet-sub" },
          el("a", { href: `mailto:${encodeURIComponent(lead.email)}` }, lead.email),
          ` · Received ${fullDate(lead.created_at)}`
        )
      ),
      el("button", { class: "btn ghost small", type: "button", onclick: () => dom.detail.close() }, "Close")
    );

    const intentSection = el(
      "section",
      {},
      el("h4", { class: "section-title" }, "Lead intent"),
      el(
        "div",
        { class: "intent-row" },
        meter(level, intentText(lead)),
        el("span", { class: "intent-label", "data-level": level }, intentText(lead))
      ),
      lead.intent_reason ? el("p", { class: "reason" }, lead.intent_reason) : null
    );

    const sections = [intentSection];

    if (lead.analysis_status !== "complete") {
      const retry = el("button", { class: "btn ghost small", type: "button" }, "Retry analysis");
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "Analyzing…";
        try {
          const updated = await api(`/api/leads/${lead.id}/analyze`, { method: "POST" });
          await loadAll();
          renderDetail(updated);
        } catch (err) {
          retry.disabled = false;
          retry.textContent = "Retry analysis";
          notice.firstChild.textContent = err.message;
        }
      });
      const notice = el(
        "div",
        { class: "notice", role: "alert" },
        el("span", {}, lead.analysis_error || "This lead has not been analyzed yet."),
        el("div", {}, retry)
      );
      sections.unshift(notice);
    }

    if (lead.summary) {
      sections.push(el("section", {}, el("h4", { class: "section-title" }, "Summary"), el("p", {}, lead.summary)));
    }

    if (lead.analysis_status === "complete") {
      sections.push(
        el(
          "section",
          {},
          el("h4", { class: "section-title" }, "Key details"),
          el(
            "dl",
            { class: "details" },
            detailItem("Need", lead.need),
            detailItem("Budget", lead.budget),
            detailItem("Timeline", lead.timeline),
            detailItem("Role", lead.role),
            detailItem("Company", lead.company),
            detailItem("Phone", lead.phone),
            detailItem("Location", lead.location)
          )
        )
      );
    }

    sections.push(
      el("section", {}, el("h4", { class: "section-title" }, "Original inquiry"), el("div", { class: "quote" }, lead.message))
    );

    if (hasDraft) {
      const copy = el("button", { class: "btn ghost small", type: "button" }, "Copy");
      copy.addEventListener("click", () => copyText(`Subject: ${subject}\n\n${body}`, copy));
      sections.push(
        el(
          "section",
          {},
          el("h4", { class: "section-title" }, "Suggested follow-up"),
          el(
            "div",
            { class: "draft" },
            el("div", { class: "draft-subject" }, subject),
            el("div", { class: "draft-body" }, body),
            el(
              "div",
              { class: "draft-actions" },
              copy,
              el("a", { class: "btn ghost small", href: mailto }, "Open in email app")
            )
          ),
          el("p", { class: "fine" }, "AI-generated draft. Review and edit before sending.")
        )
      );
    }

    const select = el("select", { id: "status-select" }, ...["new", "contacted", "closed"].map((s) => {
      const option = el("option", { value: s }, s[0].toUpperCase() + s.slice(1));
      if (s === lead.status) option.selected = true;
      return option;
    }));
    select.addEventListener("change", async () => {
      try {
        const updated = await api(`/api/leads/${lead.id}`, { method: "PATCH", body: { status: select.value } });
        await loadAll();
        renderDetail(updated);
      } catch (err) {
        select.value = lead.status;
        alert(err.message);
      }
    });

    const remove = el("button", { class: "btn danger small", type: "button" }, "Delete lead");
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete the lead from ${lead.name}? This can't be undone.`)) return;
      try {
        await api(`/api/leads/${lead.id}`, { method: "DELETE" });
        dom.detail.close();
        await loadAll();
      } catch (err) {
        alert(err.message);
      }
    });

    const foot = el(
      "div",
      { class: "sheet-foot" },
      el("div", { class: "status-field" }, el("label", { for: "status-select" }, "Status"), select),
      remove
    );

    dom.detailBody.replaceChildren(head, el("div", { class: "sheet-scroll" }, ...sections), foot);
    dom.detail.setAttribute("aria-labelledby", "detail-title");
  }

  dom.detail.addEventListener("click", (event) => {
    if (event.target === dom.detail) dom.detail.close(); // click on the backdrop
  });

  /* ---------- form ---------- */

  dom.message.addEventListener("input", () => {
    dom.counter.textContent = `${dom.message.value.length} / 4000`;
  });

  dom.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!dom.form.reportValidity()) return;

    dom.submit.disabled = true;
    dom.submit.textContent = "Analyzing…";
    dom.submit.setAttribute("aria-busy", "true");
    setMessage(dom.formMsg, "");

    try {
      const result = await api("/api/inquiries", { method: "POST", body: Object.fromEntries(new FormData(dom.form)) });
      dom.form.reset();
      dom.counter.textContent = "0 / 4000";

      if (result && result.id) {
        if (result.analysis_status === "complete") {
          setMessage(dom.formMsg, "Lead saved and analyzed.", "ok");
        } else {
          setMessage(dom.formMsg, "Lead saved, but analysis failed. Open it to retry.", "error");
        }
        await loadAll();
        openLead(result);
      } else {
        setMessage(dom.formMsg, "Inquiry received.", "ok");
      }
    } catch (err) {
      setMessage(dom.formMsg, err.message, "error");
    } finally {
      dom.submit.disabled = false;
      dom.submit.textContent = "Qualify lead";
      dom.submit.removeAttribute("aria-busy");
    }
  });

  dom.gateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setToken(dom.gateToken.value.trim());
    setMessage(dom.gateMsg, "");
    const ok = await loadAll();
    if (ok) {
      dom.gateToken.value = "";
    } else {
      setToken("");
      setMessage(dom.gateMsg, "That token didn't work. Check it and try again.", "error");
    }
  });

  dom.refresh.addEventListener("click", loadAll);

  /* ---------- theme ---------- */

  function syncThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    dom.theme.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  dom.theme.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage unavailable */ }
    syncThemeButton();
  });
  syncThemeButton();

  /* ---------- init ---------- */

  async function init() {
    try {
      const status = await api("/api/status");
      if (!status.gemini_configured) {
        dom.banner.textContent =
          "Gemini isn't configured, so new leads are saved without analysis. Add GEMINI_API_KEY to your .env file and restart the server.";
        dom.banner.hidden = false;
      }
    } catch { /* the list load below reports connection problems */ }
    await loadAll();
  }

  init();
})();
