"use strict";

const STORAGE_KEY = "freegpt.conversations.v2";
const SETTINGS_KEY = "freegpt.settings.v2";
const PASTE_ATTACH_THRESHOLD = 1500;
const PASTE_ATTACH_LINES = 15;

const state = {
  conversations: [],
  activeId: null,
  streaming: false,
  abort: null,
  editingMsg: null,
  previewAttachment: null,
  availableTools: []
};

const $ = (sel) => document.querySelector(sel);
const isMobile = () => window.matchMedia("(max-width: 760px)").matches;

const ICONS = {
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  resend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
  regenerate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
  rename: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  pencilSmall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>`,
  network: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
};

/* Settings */
const settings = loadSettings();

function loadSettings() {
  try {
    return { ...defaults(), ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch {
    return defaults();
  }
}
function defaults() {
  return {
    endpoint: window.location.origin + "/v1/chat/completions",
    showProcess: true,
    showModel: true,
    showRawErrors: false,
    theme: "dark"
  };
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applyTheme();
}
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}

/* Persistence */
function loadConversations() {
  try {
    state.conversations = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    state.conversations = [];
  }
  for (const conv of state.conversations) {
    if (!Array.isArray(conv.pendingAttachments)) conv.pendingAttachments = [];
    if (conv.mode !== "agent") conv.mode = "chat";                       // nuevo
    if (!conv.tools || typeof conv.tools !== "object") conv.tools = {};  // nuevo
    for (const msg of conv.messages) {
      if (!msg.id) msg.id = uid();
      if (msg.role === "user" && !Array.isArray(msg.attachments)) msg.attachments = [];
    }
  }
}

function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
}

/* Helpers */
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function isNearBottom(box, threshold = 120) {
  return box.scrollHeight - box.scrollTop - box.clientHeight < threshold;
}
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 1500);
}
async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy failed");
  }
}
function downloadFile(name, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* Sidebar (mobile) */
function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebar-backdrop").classList.add("visible");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.remove("visible");
}

/* Conversations */
function getActive() {
  return state.conversations.find((c) => c.id === state.activeId);
}

function createConversation() {
  const conv = {
    id: uid(),
    title: "New chat",
    model: currentModelDefault(),
    mode: "chat",           // nuevo
    tools: {},              // nuevo
    messages: [],
    pendingAttachments: []
  };
  state.conversations.unshift(conv);
  state.activeId = conv.id;
  saveConversations();
  renderSidebar();
  renderMessages();
}
function selectConversation(id) {
  state.activeId = id;
  saveConversations();
  renderSidebar();
  renderMessages();
  if (isMobile()) closeSidebar();
}
function deleteConversation(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  if (conv.messages.length > 0 && !confirm(`Delete "${conv.title}"?`)) return;
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeId === id) {
    state.activeId = state.conversations[0]?.id || null;
  }
  if (!state.activeId) {
    saveConversations();
    createConversation();
    return;
  }
  saveConversations();
  renderSidebar();
  renderMessages();
}
function renameConversation(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  const newTitle = prompt("Rename conversation:", conv.title);
  if (newTitle && newTitle.trim()) {
    conv.title = newTitle.trim();
    saveConversations();
    renderSidebar();
  }
}
function currentModelDefault() {
  const sel = document.getElementById("model-select");
  return sel?.value || "fast-chat";
}

/* Attachments */
function addPendingAttachment({ name, content }) {
  const conv = getActive();
  if (!conv) return;
  if (!Array.isArray(conv.pendingAttachments)) conv.pendingAttachments = [];
  conv.pendingAttachments.push({ id: uid(), name, content });
  saveConversations();
  renderAttachmentsBar();
}
function removePendingAttachment(id) {
  const conv = getActive();
  if (!conv) return;
  conv.pendingAttachments = conv.pendingAttachments.filter((a) => a.id !== id);
  saveConversations();
  renderAttachmentsBar();
}
function renderAttachmentsBar() {
  const bar = $("#attachments-bar");
  if (!bar) return;
  const conv = getActive();
  const attachments = conv?.pendingAttachments || [];
  if (attachments.length === 0) {
    bar.innerHTML = "";
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  bar.innerHTML = "";
  for (const att of attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.innerHTML = `
      <span class="chip-icon">${ICONS.file}</span>
      <span class="chip-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
      <button class="chip-action" data-act="edit" title="Edit">${ICONS.pencilSmall}</button>
      <button class="chip-action" data-act="remove" title="Remove">${ICONS.x}</button>
    `;
    chip.querySelector(".chip-name").addEventListener("click", () => openAttachmentPreview(att, "composer"));
    chip.querySelector("[data-act='edit']").addEventListener("click", (e) => {
      e.stopPropagation();
      openAttachmentEdit(att, "composer");
    });
    chip.querySelector("[data-act='remove']").addEventListener("click", (e) => {
      e.stopPropagation();
      removePendingAttachment(att.id);
    });
    bar.appendChild(chip);
  }
}

function openAttachmentPreview(att, context) {
  state.previewAttachment = { ...att, context };
  $("#attachment-dialog-title").textContent = att.name;
  $("#attachment-preview").textContent = att.content;
  $("#attachment-preview").classList.remove("hidden");
  $("#attachment-edit").classList.add("hidden");
  $("#attachment-edit").value = att.content;
  $("#attachment-edit-btn").classList.toggle("hidden", context !== "composer");
  $("#attachment-save-btn").classList.add("hidden");
  $("#attachment-dialog").showModal();
}
function openAttachmentEdit(att, context) {
  if (context !== "composer") return;
  openAttachmentPreview(att, context);
  switchToAttachmentEdit();
}
function switchToAttachmentEdit() {
  $("#attachment-preview").classList.add("hidden");
  $("#attachment-edit").classList.remove("hidden");
  $("#attachment-edit-btn").classList.add("hidden");
  $("#attachment-save-btn").classList.remove("hidden");
  $("#attachment-edit").focus();
}
function saveAttachmentEdit() {
  const att = state.previewAttachment;
  if (!att || att.context !== "composer") return;
  const conv = getActive();
  const target = conv?.pendingAttachments?.find((a) => a.id === att.id);
  if (target) {
    target.content = $("#attachment-edit").value;
    saveConversations();
    renderAttachmentsBar();
    toast("Attachment updated");
  }
  state.previewAttachment = null;
  $("#attachment-dialog").close();
}

/* Rendering */
function renderSidebar() {
  const nav = $("#conversations");
  nav.innerHTML = "";
  for (const conv of state.conversations) {
    const el = document.createElement("div");
    el.className = "conv" + (conv.id === state.activeId ? " active" : "");
    el.innerHTML = `
      <span class="title">${escapeHtml(conv.title)}</span>
      <span class="conv-actions">
        <button class="conv-action" data-act="rename" title="Rename">${ICONS.rename}</button>
        <button class="conv-action" data-act="delete" title="Delete">${ICONS.trash}</button>
      </span>
    `;
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === "rename") renameConversation(conv.id);
        else if (act.dataset.act === "delete") deleteConversation(conv.id);
        return;
      }
      selectConversation(conv.id);
    });
    nav.appendChild(el);
  }
}

let pendingRender = false;
function scheduleRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    renderMessages();
  });
}

function renderMessages() {
  const conv = getActive();
  const box = $("#messages");
  const wasNearBottom = isNearBottom(box);
  box.innerHTML = "";
  if (!conv) return;

  if (conv.messages.length === 0) {
    box.innerHTML = `
      <div class="empty-state">
        <h2>How can I help?</h2>
        <p>Ask anything — FreeGPT will route it to the best free provider.</p>
      </div>`;
  } else {
    for (const msg of conv.messages) {
      box.appendChild(renderMessage(msg));
    }
  }

  const sel = $("#model-select");
  if (sel.querySelector(`option[value="${conv.model}"]`)) {
    sel.value = conv.model;
  }

  if (wasNearBottom) scrollToBottom();
  renderAttachmentsBar();
  renderModeBar();
}

function renderMessage(msg) {
  const wrap = document.createElement("div");
  wrap.className = "message " + msg.role + (msg.status === "streaming" ? " streaming" : "");
  wrap.dataset.msgId = msg.id;

  // Error message: render card only
  if (msg.status === "error" && msg.errorInfo) {
    wrap.appendChild(renderErrorCard(msg.errorInfo));
    return wrap;
  }

  if (msg.role === "assistant") {
    if (msg.agentEvents?.length > 0 && settings.showProcess) {
      wrap.appendChild(renderAgentActivity(msg));
    }
    if (msg.freegpt && settings.showProcess) {
      wrap.appendChild(renderProcess(msg.freegpt, msg.status));
    }
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (msg.role === "assistant") {
    bubble.innerHTML = marked.parse(msg.content || "");
    enhanceCodeBlocks(bubble);
  } else {
    bubble.textContent = msg.content;
  }
  wrap.appendChild(bubble);

  if (msg.role === "user" && msg.attachments?.length) {
    wrap.appendChild(renderMessageAttachments(msg.attachments));
  }

  if (msg.role === "assistant" && msg.freegpt && settings.showModel) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${msg.freegpt.provider} :: ${msg.freegpt.model} · ${msg.freegpt.totalMs} ms`;
    wrap.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  if (msg.role === "user") {
    actions.innerHTML = `
      <button class="msg-action" data-action="edit" title="Edit">${ICONS.edit}</button>
      <button class="msg-action" data-action="resend" title="Resend">${ICONS.resend}</button>
      <button class="msg-action" data-action="copy" title="Copy">${ICONS.copy}</button>
    `;
  } else if (msg.role === "assistant" && msg.content) {
    actions.innerHTML = `
      <button class="msg-action" data-action="copy" title="Copy">${ICONS.copy}</button>
      <button class="msg-action" data-action="regenerate" title="Regenerate">${ICONS.regenerate}</button>
    `;
  }
  wrap.appendChild(actions);

  return wrap;
}

function renderMessageAttachments(attachments) {
  const bar = document.createElement("div");
  bar.className = "attachments-bar message-attachments";
  for (const att of attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.innerHTML = `
      <span class="chip-icon">${ICONS.file}</span>
      <span class="chip-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
    `;
    chip.addEventListener("click", () => openAttachmentPreview(att, "message"));
    bar.appendChild(chip);
  }
  return bar;
}

/* Error card */
function categorizeError(info) {
  const code = (info.code || "").toLowerCase();
  switch (code) {
    case "no_providers":
    case "no_chain":
      return {
        icon: "gear",
        tone: "warn",
        title: "No providers available",
        message: "None of the configured providers for this model could be loaded.",
        hint: "Run `freegpt doctor` in a terminal to see why each provider was skipped."
      };
    case "all_rate_limited":
      return {
        icon: "clock",
        tone: "warn",
        title: "All providers are rate-limited",
        message: "Every provider in the chain hit its rate limit.",
        hint: "Wait a few seconds and try again."
      };
    case "some_rate_limited":
      return {
        icon: "clock",
        tone: "warn",
        title: "Providers are rate-limited",
        message: "Some providers are currently rate-limited for this request.",
        hint: "Wait a moment, try again, or switch to another model."
      };
    case "auth_failed":
      return {
        icon: "key",
        tone: "warn",
        title: "Authentication failed",
        message: "One or more providers rejected the API key.",
        hint: "Run `freegpt key list` to check which keys are configured."
      };
    case "all_failed":
      return {
        icon: "warning",
        tone: "warn",
        title: "All providers failed",
        message: "Every provider in the chain returned an error.",
        hint: "Try again, or enable 'Show raw error details' in Settings."
      };
    case "network":
      return {
        icon: "network",
        tone: "warn",
        title: "Cannot reach FreeGPT",
        message: "The browser could not connect to the FreeGPT server.",
        hint: "Make sure `freegpt ui` is running and the endpoint is correct."
      };
    default:
      return {
        icon: "warning",
        tone: "warn",
        title: "Request failed",
        message: info.message || "An unexpected error occurred.",
        hint: "Try again, or enable 'Show raw error details' in Settings."
      };
  }
}

function renderErrorCard(info) {
  const cat = categorizeError(info);
  const card = document.createElement("div");
  card.className = "error-card " + cat.tone;
  card.innerHTML = `
    <div class="error-icon">${ICONS[cat.icon] || ICONS.warning}</div>
    <div class="error-body">
      <div class="error-title">${escapeHtml(cat.title)}</div>
      <div class="error-message">${escapeHtml(cat.message)}</div>
      ${cat.hint ? `<div class="error-hint">${escapeHtml(cat.hint)}</div>` : ""}
    </div>
  `;

  if (settings.showRawErrors) {
    const details = document.createElement("details");
    details.className = "error-raw";
    const raw = {
      code: info.code || null,
      message: info.message || null,
      attempts: info.attempts || [],
      skipped: info.skipped || [],
      summary: info.summary || null,
      httpStatus: info.httpStatus || null
    };
    details.innerHTML = `<summary>Raw error</summary><pre>${escapeHtml(JSON.stringify(raw, null, 2))}</pre>`;
    card.appendChild(details);
  }

  return card;
}

function renderProcess(meta, status) {
  const details = document.createElement("details");
  details.className = "process";
  details.open = status === "streaming";

  const summary = document.createElement("summary");
  const total = meta.totalMs != null ? ` · ${meta.totalMs} ms` : "";
  summary.textContent = status === "streaming" ? "Processing…" : `Process${total}`;
  details.appendChild(summary);

  for (const a of meta.attempts || []) {
    const step = document.createElement("div");
    step.className = "process-step " + (a.status === "ok" ? "ok" : a.status === "failed" ? "fail" : "trying");
    const dot = document.createElement("span");
    dot.className = "dot";
    const text = document.createElement("span");
    const dur = a.durationMs != null ? ` · ${a.durationMs} ms` : "";
    const err = a.error ? ` — ${a.error}` : "";
    text.textContent = `${a.provider} :: ${a.model} · attempt ${a.attempt} · ${a.status}${dur}${err}`;
    step.appendChild(dot);
    step.appendChild(text);
    details.appendChild(step);
  }

  return details;
}

/* Agent mode */
function agentEndpoint() {
  try {
    const base = new URL(settings.endpoint, window.location.origin);
    base.pathname = "/v1/agent/completions";
    base.search = "";
    base.hash = "";
    return base.toString();
  } catch {
    return window.location.origin + "/v1/agent/completions";
  }
}

const DANGEROUS_TOOLS = new Set(["terminal", "git"]);

function humanizeTool(name) {
  return String(name).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(ms) {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function setMode(mode) {
  const conv = getActive();
  if (!conv) return;
  conv.mode = mode === "agent" ? "agent" : "chat";
  saveConversations();
  renderModeBar();
}

function setToolEnabled(name, enabled) {
  const conv = getActive();
  if (!conv) return;
  if (!conv.tools || typeof conv.tools !== "object") conv.tools = {};
  conv.tools[name] = !!enabled;
  saveConversations();
}

function renderModeBar() {
  const conv = getActive();
  const bar = $("#mode-bar");
  if (!bar) return;

  if (!conv) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  bar.classList.toggle("disabled", state.streaming);

  for (const btn of bar.querySelectorAll(".mode-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === conv.mode);
  }

  const panel = $("#tools-panel");
  if (conv.mode !== "agent") {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  panel.classList.remove("hidden");

  const tools = state.availableTools || [];
  if (tools.length === 0) {
    panel.innerHTML = `<span class="tools-empty">No tools available on this server.</span>`;
    return;
  }

  panel.innerHTML = "";
  const sorted = [...tools].sort((a, b) => {
    const da = DANGEROUS_TOOLS.has(a.name) ? 1 : 0;
    const db = DANGEROUS_TOOLS.has(b.name) ? 1 : 0;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
  for (const tool of sorted) {
    const isDangerous = DANGEROUS_TOOLS.has(tool.name);
    const label = document.createElement("label");
    label.className = "tool-toggle" + (isDangerous ? " tool-danger" : "");
    label.title = tool.description || "";
    const checked = !!(conv.tools && conv.tools[tool.name]);
    label.innerHTML = `
      <input type="checkbox" data-tool="${escapeHtml(tool.name)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(humanizeTool(tool.name))}</span>
      ${isDangerous ? `<span class="tool-warn" title="may run commands or read local files" aria-label="may run commands or read local files">${ICONS.warning}</span>` : ""}
    `;
    label.querySelector("input").addEventListener("change", (e) => {
      setToolEnabled(tool.name, e.target.checked);
    });
    panel.appendChild(label);
  }
}

function pushAgentEvent(assistant, evt) {
  if (!Array.isArray(assistant.agentEvents)) assistant.agentEvents = [];
  const last = assistant.agentEvents[assistant.agentEvents.length - 1];
  // colapsa pensamientos consecutivos
  if (evt.type === "agent.thinking" && last && last.type === "agent.thinking") return;

  if (evt.type === "agent.started" && !assistant.agentStartedAt) {
    assistant.agentStartedAt = Date.now();
  }
  if (
    (evt.type === "agent.completed" ||
      evt.type === "agent.error" ||
      evt.type === "agent.cancelled") &&
    assistant.agentStartedAt &&
    !assistant.agentDurationMs
  ) {
    assistant.agentDurationMs = Date.now() - assistant.agentStartedAt;
  }
  assistant.agentEvents.push(evt);
}

function makeAgentStep(kind, text) {
  const step = document.createElement("div");
  step.className = "process-step " + kind;
  const dot = document.createElement("span");
  dot.className = "dot";
  const span = document.createElement("span");
  span.textContent = text;
  step.appendChild(dot);
  step.appendChild(span);
  return step;
}

function renderAgentActivity(msg) {
  const events = msg.agentEvents || [];
  const details = document.createElement("details");
  details.className = "process agent-process";
  details.open = msg.status === "streaming";

  const summary = document.createElement("summary");
  const dur = formatDuration(msg.agentDurationMs);
  if (msg.status === "streaming") {
    summary.textContent = "Agent working…";
  } else {
    summary.textContent = dur ? `Agent activity · ${dur}` : "Agent activity";
  }
  details.appendChild(summary);

  for (const evt of events) {
    if (evt.type === "agent.completed") continue; // el contenido va en la burbuja

    if (evt.type === "agent.started") {
      details.appendChild(makeAgentStep("ok", "Agent started"));
    } else if (evt.type === "agent.thinking") {
      details.appendChild(makeAgentStep("trying", "Thinking…"));
    } else if (evt.type === "tool.started") {
      details.appendChild(makeAgentStep("trying", `Tool · ${evt.tool} · running`));
    } else if (evt.type === "tool.completed") {
      details.appendChild(makeAgentStep("ok", `Tool · ${evt.tool} · done`));
    } else if (evt.type === "tool.failed") {
      const m = evt.error?.message || "failed";
      details.appendChild(makeAgentStep("fail", `Tool · ${evt.tool} · ${m}`));
    } else if (evt.type === "tool.denied") {
      const m = evt.error?.message || "denied";
      details.appendChild(makeAgentStep("warn", `Tool · ${evt.tool} · denied`));
    } else if (evt.type === "agent.error") {
      const m = evt.error?.message || "unknown";
      details.appendChild(makeAgentStep("fail", `Error: ${m}`));
    } else if (evt.type === "agent.cancelled") {
      details.appendChild(makeAgentStep("warn", "Cancelled"));
    }
  }
  return details;
}

async function loadAvailableTools() {
  try {
    const res = await fetch("/v1/agent/tools");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.availableTools = Array.isArray(json.tools) ? json.tools : [];
  } catch (err) {
    console.warn("[freegpt] failed to load agent tools:", err);
    state.availableTools = [];
  }
}

function enhanceCodeBlocks(container) {
  if (!container) return;

  const languageNames = {
    js: "JavaScript",
    javascript: "JavaScript",
    ts: "TypeScript",
    typescript: "TypeScript",
    py: "Python",
    python: "Python",
    html: "HTML",
    xml: "XML",
    css: "CSS",
    json: "JSON",
    bash: "Bash",
    sh: "Shell",
    shell: "Shell",
    plaintext: "Plain text",
    text: "Plain text",
    txt: "Plain text",
    md: "Markdown",
    markdown: "Markdown",
    yml: "YAML",
    yaml: "YAML",
    rb: "Ruby",
    rs: "Rust",
    go: "Go",
    java: "Java",
    c: "C",
    cpp: "C++",
    cs: "C#",
    php: "PHP",
    sql: "SQL",
    diff: "Diff",
    dockerfile: "Dockerfile",
    makefile: "Makefile"
  };

  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".code-block")) return;

    const code = pre.querySelector("code");
    let language = "";
    let explicitLanguage = "";

    if (code) {
      const languageClass = [...code.classList].find((name) =>
        name.startsWith("language-")
      );

      if (languageClass) {
        explicitLanguage = languageClass.slice("language-".length)
          .trim().split(/\s+/)[0].toLowerCase();
      }

      if (window.hljs) {
        try {
          if (explicitLanguage && hljs.getLanguage(explicitLanguage)) {
            language = explicitLanguage;
            hljs.highlightElement(code);
          } else if (!explicitLanguage) {
            const result = hljs.highlightAuto(code.textContent);
            if (result.language && result.language !== "plaintext") {
              language = result.language;
              code.innerHTML = result.value;
              code.classList.add("hljs");
              code.classList.add(`language-${result.language}`);
            }
          } else {
            // Lenguaje explícito no incluido en el build de Highlight.js.
            language = explicitLanguage;
          }
        } catch (err) {
          console.warn("[freegpt] syntax highlighting failed:", err);
        }
      } else if (explicitLanguage) {
        language = explicitLanguage;
      }
    }

    const label = language
      ? (languageNames[language] || language.toUpperCase())
      : "Code";

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const header = document.createElement("div");
    header.className = "code-header";

    const languageLabel = document.createElement("span");
    languageLabel.className = "code-language";
    languageLabel.textContent = label;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-code";
    btn.textContent = "Copy";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(code ? code.textContent : pre.textContent, "Code copied");
    });

    header.appendChild(languageLabel);
    header.appendChild(btn);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

function scrollToBottom() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

/* Message actions */
async function handleMessageAction(msgId, action) {
  const conv = getActive();
  if (!conv) return;
  const idx = conv.messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return;
  const msg = conv.messages[idx];

  if (action === "copy") {
    let text = msg.content;
    if (msg.attachments?.length) {
      const prefix = msg.attachments.map((a) => `[${a.name}]\n${a.content}`).join("\n\n");
      text = prefix + (text ? "\n\n" + text : "");
    }
    await copyText(text, "Copied to clipboard");
    return;
  }
  if (action === "edit" && msg.role === "user") return openEditDialog(msg);
  if (action === "resend" && msg.role === "user") {
    if (state.streaming) return;
    conv.messages = conv.messages.slice(0, idx + 1);
    saveConversations();
    renderMessages();
    await streamAssistantResponse(conv);
    return;
  }
  if (action === "regenerate" && msg.role === "assistant") {
    if (state.streaming) return;
    conv.messages = conv.messages.slice(0, idx);
    saveConversations();
    renderMessages();
    await streamAssistantResponse(conv);
    return;
  }
}

function openEditDialog(msg) {
  state.editingMsg = msg;
  $("#edit-text").value = msg.content;
  $("#edit-dialog").showModal();
  setTimeout(() => $("#edit-text").focus(), 50);
}

async function saveEditedMessage() {
  const editing = state.editingMsg;
  if (!editing) return;
  const newContent = $("#edit-text").value.trim();
  if (!newContent && !editing.attachments?.length) return;

  const conv = getActive();
  if (!conv) return;
  const idx = conv.messages.findIndex((m) => m.id === editing.id);
  if (idx < 0) return;

  conv.messages[idx].content = newContent;
  conv.messages = conv.messages.slice(0, idx + 1);
  saveConversations();
  renderMessages();
  state.editingMsg = null;

  await streamAssistantResponse(conv);
}

/* Send / stream */
async function sendMessage() {
  const conv = getActive();
  if (!conv || state.streaming) return;

  const input = $("#input");
  const text = input.value.trim();
  const attachments = (conv.pendingAttachments || []).slice();
  if (!text && attachments.length === 0) return;

  input.value = "";
  input.style.height = "auto";

  conv.messages.push({
    id: uid(),
    role: "user",
    content: text,
    attachments: attachments.map((a) => ({ id: uid(), name: a.name, content: a.content }))
  });
  conv.pendingAttachments = [];
  if (conv.title === "New chat") {
    const source = text || attachments[0]?.name || "New chat";
    conv.title = source.slice(0, 40).trim();
  }
  saveConversations();
  renderSidebar();
  renderAttachmentsBar();

  await streamAssistantResponse(conv);
}

function buildApiMessages(messages) {
  return messages
    .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
    .map((m) => {
      if (m.role === "user" && m.attachments?.length) {
        const prefix = m.attachments
          .map((a) => `**📎 ${a.name}**\n\`\`\`\n${a.content}\n\`\`\`\n`)
          .join("\n");
        const content = m.content ? `${prefix}\n${m.content}` : prefix;
        return { role: "user", content };
      }
      return { role: m.role, content: m.content };
    });
}

async function streamAssistantResponse(conv) {
  const assistant = {
    id: uid(),
    role: "assistant",
    content: "",
    status: "streaming",
    freegpt: null,
    agentEvents: []
  };
  conv.messages.push(assistant);
  saveConversations();
  renderMessages();
  scrollToBottom();

  state.streaming = true;
  $("#send").classList.add("hidden");
  $("#stop").classList.remove("hidden");
  $("#status").textContent = "Connecting…";

  const controller = new AbortController();
  state.abort = controller;

  try {
    const apiMessages = buildApiMessages(conv.messages);

    const isAgent = conv.mode === "agent";
    const endpoint = isAgent ? agentEndpoint() : settings.endpoint;
    const requestBody = isAgent
      ? { model: conv.model, mode: "agent", tools: conv.tools || {}, messages: apiMessages, stream: true }
      : { model: conv.model, messages: apiMessages, stream: true };

    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (netErr) {
      const e = new Error(netErr.message || "Network error");
      e.code = "network";
      e.raw = { name: netErr.name, message: netErr.message };
      throw e;
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const apiErr = errJson.error || {};
      const fg = errJson.freegpt || {};
      const e = new Error(apiErr.message || `HTTP ${res.status}`);
      e.code = (apiErr.code || "").toLowerCase();
      e.httpStatus = res.status;
      e.attempts = fg.attempts || [];
      e.skipped = fg.skipped || [];
      e.summary = fg.summary || "";
      e.raw = errJson;
      if (apiErr.code === "context_exceeded") e.contextExceeded = true;
      throw e;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let needsRender = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          let evt;
          try { evt = JSON.parse(data); } catch { continue; }

          if (evt.type && (evt.type.startsWith("agent.") || evt.type.startsWith("tool."))) {
            pushAgentEvent(assistant, evt);
            needsRender = true;
            continue;
          }

          if (evt.freegpt) { assistant.freegpt = evt.freegpt; needsRender = true; continue; }
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) { assistant.content += delta; needsRender = true; }
          if (evt.choices?.[0]?.finish_reason) { assistant.status = "done"; needsRender = true; }
        }
      }
      if (needsRender) { needsRender = false; scheduleRender(); }
    }

    assistant.status = "done";
    $("#status").textContent = "";
  } catch (err) {
    if (err.name === "AbortError") {
      assistant.status = "stopped";
      assistant.content += "\n\n_(stopped)_";
    } else if (err.contextExceeded) {
      conv.messages.pop();
      saveConversations();
      renderMessages();
      showContextDialog(conv);
      $("#status").textContent = "";
      state.streaming = false;
      state.abort = null;
      $("#send").classList.remove("hidden");
      $("#stop").classList.add("hidden");
      return;
    } else {
      assistant.status = "error";
      assistant.errorInfo = {
        code: err.code || "unknown",
        message: err.message || "Unknown error",
        attempts: err.attempts || [],
        skipped: err.skipped || [],
        summary: err.summary || "",
        httpStatus: err.httpStatus || null,
        raw: err.raw || null
      };
      $("#status").textContent = "";
    }
  } finally {
    state.streaming = false;
    state.abort = null;
    $("#send").classList.remove("hidden");
    $("#stop").classList.add("hidden");
    saveConversations();
    renderMessages();
  }
}

/* Files */
async function handleFileSelect(file) {
  if (!file) return;
  if (file.size > 200 * 1024) { toast(`File too large (${(file.size / 1024).toFixed(0)}KB). Max 200KB.`); return; }
  const isText = file.type.startsWith("text/") ||
    /\.(txt|md|js|ts|py|json|csv|html|css|xml|yaml|yml|sh|rb|go|rs|java|c|cpp|h)$/i.test(file.name);
  if (!isText) { toast("Only text files are supported."); return; }
  try {
    const text = await file.text();
    addPendingAttachment({ name: file.name, content: text });
    toast(`Attached ${file.name}`);
  } catch (err) {
    toast(`Failed to read file: ${err.message}`);
  }
}

/* Context exceeded */
let contextDialogState = { conv: null };

function showContextDialog(conv) {
  contextDialogState = { conv };
  $("#context-dialog").showModal();
}
function hideContextDialog() {
  $("#context-dialog").close();
  contextDialogState = { conv: null };
}
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}
function estimateMessageTokens(msg) {
  let t = estimateTokens(msg.content);
  if (msg.attachments?.length) {
    for (const att of msg.attachments) t += estimateTokens(att.content);
  }
  return t;
}
function chunkMessagesByTokens(messages, maxPerChunk) {
  const chunks = [];
  let current = [];
  let currentTokens = 0;
  for (const msg of messages) {
    const t = estimateMessageTokens(msg) + 4;
    if (currentTokens + t > maxPerChunk && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += t;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
async function callSummarize(messages) {
  const flatText = messages.map((m) => {
    let text = `[${m.role}]: ${m.content || ""}`;
    if (m.attachments?.length) {
      text += "\n" + m.attachments.map((a) => `[attachment: ${a.name}]\n${a.content}`).join("\n");
    }
    return text;
  }).join("\n\n");

  const res = await fetch(settings.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: currentModelDefault(),
      messages: [
        {
          role: "system",
          content:
            "You are a summarization assistant. Summarize the following conversation, preserving key technical decisions, code context, user requirements, and any open questions. Be concise but keep important details. Output only the summary."
        },
        { role: "user", content: flatText }
      ],
      stream: false
    })
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
async function compactBySummary(srcConv) {
  const msgs = srcConv.messages;
  if (msgs.length === 0) return;
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) { toast("No user message to continue from"); return; }

  const lastUser = msgs[lastUserIdx];
  const toSummarize = msgs.slice(0, lastUserIdx);
  if (toSummarize.length === 0) { toast("Nothing to summarize"); return; }

  $("#status").textContent = "Summarizing…";
  let combined;
  try {
    const chunks = chunkMessagesByTokens(toSummarize, 3000);
    const summaries = [];
    for (const chunk of chunks) {
      const s = await callSummarize(chunk);
      if (s) summaries.push(s);
    }
    if (summaries.length === 0) throw new Error("No summary produced");
    combined = summaries.join("\n\n---\n\n");
  } catch (err) {
    $("#status").textContent = "";
    toast(`Summarize failed: ${err.message}`);
    return;
  }
  $("#status").textContent = "";

  const newContent =
    `[Summary of the previous conversation, which was too large to continue]:\n\n` +
    `${combined}\n\n---\n\n` +
    `Continuing from there, my next message:\n\n${lastUser.content}`;

  const newConv = {
    id: uid(),
    title: `${srcConv.title} (continued)`,
    model: srcConv.model,
    mode: srcConv.mode || "chat",
    tools: { ...(srcConv.tools || {}) },
    messages: [{ id: uid(), role: "user", content: newContent, attachments: [] }],
    pendingAttachments: []
  };
  state.conversations.unshift(newConv);
  state.activeId = newConv.id;
  saveConversations();
  renderSidebar();
  renderMessages();
  toast("New conversation created. Review and send.");
}
function compactByTruncate(srcConv, maxTokens) {
  const msgs = srcConv.messages;
  if (msgs.length === 0) return;
  const keep = [];
  let tokens = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    const t = estimateMessageTokens(msg) + 4;
    if (tokens + t > maxTokens && keep.length > 0) break;
    keep.unshift(msg);
    tokens += t;
  }
  if (keep.length === 0) { toast("Not enough tokens to keep anything"); return; }

  const newConv = {
    id: uid(),
    title: `${srcConv.title} (continued)`,
    model: srcConv.model,
    mode: srcConv.mode || "chat",
    tools: { ...(srcConv.tools || {}) },
    messages: keep.map((m) => ({
      ...m, id: uid(),
      attachments: m.attachments ? [...m.attachments] : []
    })),
    pendingAttachments: []
  };
  state.conversations.unshift(newConv);
  state.activeId = newConv.id;
  saveConversations();
  renderSidebar();
  renderMessages();
  toast(`New conversation created with last ~${tokens} tokens`);
}

/* Export */
function doExport() {
  const scope = document.querySelector('input[name="export-scope"]:checked').value;
  const format = $("#export-format").value;
  const convs = scope === "all" ? state.conversations : (getActive() ? [getActive()] : []);
  if (convs.length === 0) { toast("Nothing to export."); return; }
  const ts = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    const data = scope === "all" ? { conversations: convs, exportedAt: new Date().toISOString() } : convs[0];
    downloadFile(`freegpt-export-${ts}.json`, JSON.stringify(data, null, 2), "application/json");
  } else {
    const md = convs.map(formatConversationAsMarkdown).join("\n\n---\n\n");
    downloadFile(`freegpt-export-${ts}.md`, md, "text/markdown");
  }
  toast(`Exported ${convs.length} conversation${convs.length > 1 ? "s" : ""}`);
}
function formatConversationAsMarkdown(conv) {
  const lines = [`# ${conv.title}`, `_Model: ${conv.model}_`, ""];
  for (const msg of conv.messages) {
    if (!msg.content && !msg.attachments?.length) continue;
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Error";
    lines.push(`## ${role}`, "");
    if (msg.status === "error" && msg.errorInfo) {
      lines.push(`**Error (${msg.errorInfo.code}):** ${msg.errorInfo.message}`, "");
      continue;
    }
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        lines.push(`**Attachment: ${att.name}**`, "```", att.content, "```", "");
      }
    }
    if (msg.content) lines.push(msg.content, "");
  }
  return lines.join("\n");
}

/* Event wiring */
$("#new-chat").addEventListener("click", () => { createConversation(); if (isMobile()) closeSidebar(); });
$("#header-new-chat").addEventListener("click", createConversation);
$("#toggle-theme").addEventListener("click", () => { settings.theme = settings.theme === "dark" ? "light" : "dark"; saveSettings(); });
$("#send").addEventListener("click", sendMessage);
$("#stop").addEventListener("click", () => state.abort?.abort());

$("#mode-bar").addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  setMode(btn.dataset.mode);
});

$("#toggle-sidebar").addEventListener("click", openSidebar);
$("#close-sidebar").addEventListener("click", closeSidebar);
$("#sidebar-backdrop").addEventListener("click", closeSidebar);

$("#attach-btn").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (e) => { handleFileSelect(e.target.files?.[0]); e.target.value = ""; });

$("#export-btn").addEventListener("click", () => $("#export-dialog").showModal());
$("#do-export").addEventListener("click", (e) => { e.preventDefault(); doExport(); $("#export-dialog").close(); });

$("#save-edit").addEventListener("click", (e) => { e.preventDefault(); $("#edit-dialog").close(); saveEditedMessage(); });

$("#attachment-cancel-btn").addEventListener("click", () => { state.previewAttachment = null; $("#attachment-dialog").close(); });
$("#attachment-edit-btn").addEventListener("click", switchToAttachmentEdit);
$("#attachment-save-btn").addEventListener("click", saveAttachmentEdit);

$("#context-cancel-btn").addEventListener("click", hideContextDialog);
$("#context-summarize-btn").addEventListener("click", async () => {
  const { conv } = contextDialogState;
  if (!conv) return;
  hideContextDialog();
  await compactBySummary(conv);
});
$("#context-truncate-btn").addEventListener("click", () => {
  const { conv } = contextDialogState;
  if (!conv) return;
  const tokens = Number($("#context-keep-tokens").value) || 4000;
  hideContextDialog();
  compactByTruncate(conv, tokens);
});

$("#open-settings").addEventListener("click", () => {
  $("#setting-endpoint").value = settings.endpoint;
  $("#setting-show-process").checked = settings.showProcess;
  $("#setting-show-model").checked = settings.showModel;
  $("#setting-show-raw-errors").checked = settings.showRawErrors;
  $("#settings-dialog").showModal();
});
$("#save-settings").addEventListener("click", (e) => {
  e.preventDefault();
  settings.endpoint = $("#setting-endpoint").value.trim() || (window.location.origin + "/v1/chat/completions");
  settings.showProcess = $("#setting-show-process").checked;
  settings.showModel = $("#setting-show-model").checked;
  settings.showRawErrors = $("#setting-show-raw-errors").checked;
  saveSettings();
  $("#settings-dialog").close();
  renderMessages();
});

$("#model-select").addEventListener("change", (e) => {
  const conv = getActive();
  if (conv) { conv.model = e.target.value; saveConversations(); }
});

$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendMessage();
  }
});
$("#input").addEventListener("input", () => {
  const el = $("#input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
});
$("#input").addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text/plain");
  if (!text) return;
  const lines = text.split("\n").length;
  if (text.length > PASTE_ATTACH_THRESHOLD || lines > PASTE_ATTACH_LINES) {
    e.preventDefault();
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
    addPendingAttachment({ name: `pasted-${stamp}.txt`, content: text });
    toast("Pasted as attachment");
  }
});

$("#messages").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const msgEl = btn.closest("[data-msg-id]");
  if (!msgEl) return;
  handleMessageAction(msgEl.dataset.msgId, btn.dataset.action);
});

/* Init */
async function loadModels() {
  try {
    const res = await fetch("/v1/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const sel = $("#model-select");
    const prev = sel.value;
    sel.innerHTML = "";
    for (const m of json.data || []) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.id;
      sel.appendChild(opt);
    }
    if (prev) sel.value = prev;
  } catch (err) {
    console.warn("[freegpt] failed to load models:", err);
  }
}

(async function init() {
  applyTheme();
  loadConversations();
  await loadModels();
  await loadAvailableTools();
  if (state.conversations.length === 0) {
    createConversation();
  } else {
    state.activeId = state.conversations[0].id;
    renderSidebar();
    renderMessages();
  }
})();
