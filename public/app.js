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
  previewAttachment: null
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
  pencilSmall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
};

/* ---------- Settings ---------- */

const settings = loadSettings();

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || defaults();
  } catch {
    return defaults();
  }
}
function defaults() {
  return {
    endpoint: window.location.origin + "/v1/chat/completions",
    showProcess: true,
    showModel: true,
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

/* ---------- Persistence ---------- */

function loadConversations() {
  try {
    state.conversations = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    state.conversations = [];
  }
  for (const conv of state.conversations) {
    if (!Array.isArray(conv.pendingAttachments)) conv.pendingAttachments = [];
    for (const msg of conv.messages) {
      if (!msg.id) msg.id = uid();
      if (msg.role === "user" && !Array.isArray(msg.attachments)) msg.attachments = [];
    }
  }
}
function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
}

/* ---------- Helpers ---------- */

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

/* ---------- Sidebar (mobile) ---------- */

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebar-backdrop").classList.add("visible");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.remove("visible");
}

/* ---------- Conversations ---------- */

function getActive() {
  return state.conversations.find((c) => c.id === state.activeId);
}
function createConversation() {
  const conv = {
    id: uid(),
    title: "New chat",
    model: currentModelDefault(),
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

/* ---------- Pending attachments (composer) ---------- */

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

/* ---------- Attachment preview/edit dialog ---------- */

function openAttachmentPreview(att, context) {
  state.previewAttachment = { ...att, context };
  $("#attachment-dialog-title").textContent = att.name;
  $("#attachment-preview").textContent = att.content;
  $("#attachment-preview").classList.remove("hidden");
  $("#attachment-edit").classList.add("hidden");
  $("#attachment-edit").value = att.content;
  if (context === "composer") {
    $("#attachment-edit-btn").classList.remove("hidden");
  } else {
    $("#attachment-edit-btn").classList.add("hidden");
  }
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

/* ---------- Rendering ---------- */

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
}

function renderMessage(msg) {
  const wrap = document.createElement("div");
  wrap.className = "message " + msg.role + (msg.status === "streaming" ? " streaming" : "");
  wrap.dataset.msgId = msg.id;

  if (msg.role === "assistant" && msg.freegpt && settings.showProcess) {
    wrap.appendChild(renderProcess(msg.freegpt, msg.status));
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (msg.role === "assistant") {
    bubble.innerHTML = marked.parse(msg.content || "");
    enhanceCodeBlocks(bubble);
    bubble.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) {
        try { hljs.highlightElement(block); } catch {}
      }
    });
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

function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".copy-code")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-code";
    btn.textContent = "Copy";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const code = pre.querySelector("code") || pre;
      copyText(code.textContent, "Code copied");
    });
    pre.appendChild(btn);
  });
}

function scrollToBottom() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

/* ---------- Message actions ---------- */

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

  if (action === "edit" && msg.role === "user") {
    openEditDialog(msg);
    return;
  }

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

/* ---------- Send / stream ---------- */

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
    freegpt: null
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

    const res = await fetch(settings.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: conv.model,
        messages: apiMessages,
        stream: true
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
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

          if (evt.freegpt) {
            assistant.freegpt = evt.freegpt;
            needsRender = true;
            continue;
          }
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) {
            assistant.content += delta;
            needsRender = true;
          }
          if (evt.choices?.[0]?.finish_reason) {
            assistant.status = "done";
            needsRender = true;
          }
        }
      }
      if (needsRender) {
        needsRender = false;
        scheduleRender();
      }
    }

    assistant.status = "done";
    $("#status").textContent = "";
  } catch (err) {
    if (err.name === "AbortError") {
      assistant.status = "stopped";
      assistant.content += "\n\n_(stopped)_";
    } else {
      assistant.status = "error";
      assistant.content = `**Error:** ${err.message}`;
    }
    $("#status").textContent = "";
  } finally {
    state.streaming = false;
    state.abort = null;
    $("#send").classList.remove("hidden");
    $("#stop").classList.add("hidden");
    saveConversations();
    renderMessages();
  }
}

/* ---------- Files ---------- */

async function handleFileSelect(file) {
  if (!file) return;
  if (file.size > 200 * 1024) {
    toast(`File too large (${(file.size / 1024).toFixed(0)}KB). Max 200KB.`);
    return;
  }
  const isText =
    file.type.startsWith("text/") ||
    /\.(txt|md|js|ts|py|json|csv|html|css|xml|yaml|yml|sh|rb|go|rs|java|c|cpp|h)$/i.test(file.name);
  if (!isText) {
    toast("Only text files are supported.");
    return;
  }
  try {
    const text = await file.text();
    addPendingAttachment({ name: file.name, content: text });
    toast(`Attached ${file.name}`);
  } catch (err) {
    toast(`Failed to read file: ${err.message}`);
  }
}

/* ---------- Export ---------- */

function doExport() {
  const scope = document.querySelector('input[name="export-scope"]:checked').value;
  const format = $("#export-format").value;
  const convs = scope === "all"
    ? state.conversations
    : (getActive() ? [getActive()] : []);

  if (convs.length === 0) {
    toast("Nothing to export.");
    return;
  }

  const ts = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const data = scope === "all"
      ? { conversations: convs, exportedAt: new Date().toISOString() }
      : convs[0];
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
    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${role}`, "");
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        lines.push(`**Attachment: ${att.name}**`, "```", att.content, "```", "");
      }
    }
    if (msg.content) lines.push(msg.content, "");
  }
  return lines.join("\n");
}

/* ---------- Event wiring ---------- */

$("#new-chat").addEventListener("click", () => {
  createConversation();
  if (isMobile()) closeSidebar();
});
$("#header-new-chat").addEventListener("click", createConversation);
$("#toggle-theme").addEventListener("click", () => {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  saveSettings();
});
$("#send").addEventListener("click", sendMessage);
$("#stop").addEventListener("click", () => state.abort?.abort());

$("#toggle-sidebar").addEventListener("click", openSidebar);
$("#close-sidebar").addEventListener("click", closeSidebar);
$("#sidebar-backdrop").addEventListener("click", closeSidebar);

$("#attach-btn").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (e) => {
  handleFileSelect(e.target.files?.[0]);
  e.target.value = "";
});

$("#export-btn").addEventListener("click", () => {
  $("#export-dialog").showModal();
});
$("#do-export").addEventListener("click", (e) => {
  e.preventDefault();
  doExport();
  $("#export-dialog").close();
});

$("#save-edit").addEventListener("click", (e) => {
  e.preventDefault();
  $("#edit-dialog").close();
  saveEditedMessage();
});

$("#attachment-cancel-btn").addEventListener("click", () => {
  state.previewAttachment = null;
  $("#attachment-dialog").close();
});
$("#attachment-edit-btn").addEventListener("click", switchToAttachmentEdit);
$("#attachment-save-btn").addEventListener("click", saveAttachmentEdit);

$("#open-settings").addEventListener("click", () => {
  $("#setting-endpoint").value = settings.endpoint;
  $("#setting-show-process").checked = settings.showProcess;
  $("#setting-show-model").checked = settings.showModel;
  $("#settings-dialog").showModal();
});
$("#save-settings").addEventListener("click", (e) => {
  e.preventDefault();
  settings.endpoint = $("#setting-endpoint").value.trim() || (window.location.origin + "/v1/chat/completions");
  settings.showProcess = $("#setting-show-process").checked;
  settings.showModel = $("#setting-show-model").checked;
  saveSettings();
  $("#settings-dialog").close();
  renderMessages();
});

$("#model-select").addEventListener("change", (e) => {
  const conv = getActive();
  if (conv) {
    conv.model = e.target.value;
    saveConversations();
  }
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

/* ---------- Init ---------- */

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
  if (state.conversations.length === 0) {
    createConversation();
  } else {
    state.activeId = state.conversations[0].id;
    renderSidebar();
    renderMessages();
  }
})();