const t = window.I18N.t;

// Small fetch wrapper around the backend API. All paths are relative to /api.
async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b && b.error) msg = b.error; } catch (err) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

const form = document.querySelector("#recipe-form");
const cancelFormBtn = document.querySelector("#cancel-form");
const searchInput = document.querySelector("#search");
const searchClear = document.querySelector("#search-clear");
const list = document.querySelector("#recipe-list");
const countEl = document.querySelector("#count");
const emptyEl = document.querySelector("#empty");
const statusEl = document.querySelector("#status");
const pageSizeSelect = document.querySelector("#page-size");
const sortSelect = document.querySelector("#sort");
const paginationEl = document.querySelector("#pagination");
const refreshBtn = document.querySelector("#refresh");
const addRecipeToggle = document.querySelector("#add-recipe-toggle");
const addRecipeSection = document.querySelector("#add-recipe-section");
const tagChipsEl = document.querySelector("#tag-chips");
const tagBrowseBtn = document.querySelector("#tag-browse-btn");
const tagFilterBtn = document.querySelector("#tag-filter-btn");
const tagFilterEl = document.querySelector("#tag-filter");
const tagFilterChips = document.querySelector("#tag-filter-chips");
const tagFilterClear = document.querySelector("#tag-filter-clear");
const tagPicker = document.querySelector("#tag-picker");
const tagPickerTitle = document.querySelector("#tag-picker-title");
const tagPickerClose = document.querySelector("#tag-picker-close");
const tagPickerSearch = document.querySelector("#tag-picker-search");
const tagPickerSelected = document.querySelector("#tag-picker-selected");
const tagPickerCount = document.querySelector("#tag-picker-count");
const tagPickerList = document.querySelector("#tag-picker-list");
const tagPickerPagination = document.querySelector("#tag-picker-pagination");
const tagPickerCreate = document.querySelector("#tag-picker-create");
const tagPickerApply = document.querySelector("#tag-picker-apply");

const appEl = document.querySelector("#app");
const authScreen = document.querySelector("#auth-screen");
const authForm = document.querySelector("#auth-form");
const authEmail = document.querySelector("#auth-email");
const authPassword = document.querySelector("#auth-password");
const authError = document.querySelector("#auth-error");
const logoutBtn = document.querySelector("#logout");
const recycleBinBtn = document.querySelector("#recycle-bin-btn");
const recycleBin = document.querySelector("#recycle-bin");
const recycleBinClose = document.querySelector("#recycle-bin-close");
const recycleBinList = document.querySelector("#recycle-bin-list");
const recycleBinCount = document.querySelector("#recycle-bin-count");
const recycleBinRestoreAll = document.querySelector("#recycle-bin-restore-all");
const recycleBinEmpty = document.querySelector("#recycle-bin-empty");
const lightbox = document.querySelector("#lightbox");
const lightboxClose = document.querySelector("#lightbox-close");

let isAuthed = false;
let isEditor = true;

const editors = {
  ingredient: document.querySelector("#ingredients-editor"),
  step: document.querySelector("#steps-editor"),
  cookware: document.querySelector("#cookware-editor"),
};
const recipeMediaInput = document.querySelector("#recipe-media");
const recipeMediaPreview = document.querySelector("#recipe-media-preview");

let recipes = [];
let pageSize = 5;
let currentPage = 1;
let totalCount = 0;
let sortColumn = "created_at";
let sortAscending = false;
let loadSeq = 0;
let searchTimer = null;
let formTags = [];
let tagFilter = [];
let tagPickerSelection = new Set();
let tagPickerTerm = "";
let tagPickerPage = 1;
let tagPickerTotal = 0;
let tagPickerSearchTimer = null;
let tagPickerMode = "filter";
let tagPickerRecipeId = null;
let tagNames = new Map();
let binRecipes = [];
const TAG_PICKER_PAGE_SIZE = 20;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  if (message) setTimeout(() => { if (statusEl.textContent === message) statusEl.textContent = ""; }, 3000);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(I18N.get() === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function val(input) {
  return input ? input.value.trim() : "";
}

// Media files live on the backend's disk and are served (session-gated) from
// /media/file/{path}; a stored path is immutable, so URLs never expire.
function mediaUrl(path) {
  return "/media/file/" + encodeURIComponent(path);
}

// ---------- Row-based editors ----------

function rowTemplate(kind, r = {}) {
  const section = `<input class="row-section" placeholder="${t("rows.section")}" value="${escapeHtml(r.section || "")}">`;
  const media = mediaPreviewHtml(r.media || []);
  const file = `<label class="file-label">${t("rows.addMedia")} <input class="row-file" type="file" accept="image/*,video/*" multiple></label>`;
  const actions = `
    <div class="row-actions">
      <button type="button" class="secondary row-up" title="${t("rows.moveUp")}">↑</button>
      <button type="button" class="secondary row-down" title="${t("rows.moveDown")}">↓</button>
      <button type="button" class="danger row-remove" title="${t("rows.remove")}">${t("rows.remove")}</button>
    </div>`;

  if (kind === "ingredient") {
    return `<div class="row">${section}
      <input class="row-amount" placeholder="${t("rows.amount")}" value="${escapeHtml(r.amount || "")}">
      <input class="row-name" placeholder="${t("rows.ingredientName")}" value="${escapeHtml(r.name || "")}">
      <input class="row-note" placeholder="${t("rows.note")}" value="${escapeHtml(r.note || "")}">
      ${media}${file}${actions}</div>`;
  }
  if (kind === "step") {
    return `<div class="row">${section}
      <textarea class="row-text" placeholder="${t("rows.whatToDo")}" rows="2">${escapeHtml(r.text || "")}</textarea>
      <input class="row-duration" type="number" min="0" placeholder="${t("rows.minutes")}" value="${r.duration_min ?? ""}">
      <input class="row-note" placeholder="${t("rows.note")}" value="${escapeHtml(r.note || "")}">
      ${media}${file}${actions}</div>`;
  }
  return `<div class="row">
    <input class="row-name" placeholder="${t("rows.cookwareName")}" value="${escapeHtml(r.name || "")}">
    <input class="row-note" placeholder="${t("rows.note")}" value="${escapeHtml(r.note || "")}">
    ${media}${file}${actions}</div>`;
}

function addRow(kind) {
  editors[kind].insertAdjacentHTML("beforeend", rowTemplate(kind));
}

Object.entries(editors).forEach(([kind, editor]) => {
  editor.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const row = btn.closest(".row");
    if (btn.classList.contains("row-up") && row && row.previousElementSibling) editor.insertBefore(row, row.previousElementSibling);
    else if (btn.classList.contains("row-down") && row && row.nextElementSibling) editor.insertBefore(row.nextElementSibling, row);
    else if (btn.classList.contains("row-remove")) row.remove();
    else if (btn.classList.contains("remove-media")) e.target.closest(".media-preview").remove();
  });
});

document.querySelectorAll(".add-row").forEach(btn => {
  btn.addEventListener("click", () => addRow(btn.dataset.kind));
});

recipeMediaPreview.addEventListener("click", e => {
  const btn = e.target.closest("button.remove-media");
  if (btn) btn.closest(".media-preview").remove();
});

function readRows(kind) {
  return Array.from(editors[kind].querySelectorAll(".row")).map(row => {
    const base = {
      files: Array.from(row.querySelector(".row-file").files),
      keptPaths: Array.from(row.querySelectorAll(".media-preview")).map(p => p.dataset.path),
      media: [],
    };
    if (kind === "ingredient") {
      return {
        ...base,
        section: val(row.querySelector(".row-section")) || null,
        amount: val(row.querySelector(".row-amount")),
        name: val(row.querySelector(".row-name")),
        note: val(row.querySelector(".row-note")) || null,
      };
    }
    if (kind === "step") {
      return {
        ...base,
        section: val(row.querySelector(".row-section")) || null,
        text: val(row.querySelector(".row-text")),
        duration_min: row.querySelector(".row-duration").value ? Number(row.querySelector(".row-duration").value) : null,
        note: val(row.querySelector(".row-note")) || null,
      };
    }
    return {
      ...base,
      name: val(row.querySelector(".row-name")),
      note: val(row.querySelector(".row-note")) || null,
    };
  });
}

function mediaPreviewHtml(items) {
  return (items || []).map(m => `
    <figure class="media-preview" data-path="${escapeHtml(m.path)}">
      ${m.type === "video"
        ? `<video src="${escapeHtml(m.url || mediaUrl(m.path))}" muted preload="metadata"></video>`
        : `<img src="${escapeHtml(m.url || mediaUrl(m.path))}" alt="${escapeHtml(m.alt || "")}" loading="lazy">`}
      <button type="button" class="remove-media" title="${t("rows.remove")}">×</button>
    </figure>`).join("");
}

function populateEditor(kind, rows) {
  editors[kind].innerHTML = (rows || []).map(r => rowTemplate(kind, r)).join("");
}

function populateForm(r) {
  form.title.value = r.title;
  form.notes.value = r.notes || "";
  formTags = Array.isArray(r.meta_info?.tags) ? r.meta_info.tags.map(tag => String(tag)) : [];
  renderFormTagChips();
  populateEditor("ingredient", r.ingredients);
  populateEditor("step", r.steps);
  populateEditor("cookware", r.cookware);
  recipeMediaPreview.innerHTML = mediaPreviewHtml(r.media || []);
  form.dataset.editingId = r.id;
  form.querySelector("button[type=submit]").textContent = t("form.update");
}

function resetForm() {
  form.reset();
  delete form.dataset.editingId;
  ["ingredient", "step", "cookware"].forEach(k => { editors[k].innerHTML = ""; });
  recipeMediaPreview.innerHTML = "";
  formTags = [];
  renderFormTagChips();
  form.querySelector("button[type=submit]").textContent = t("form.save");
}

// ---------- Tags ----------

function normalizeTag(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadTagNames() {
  if (!isAuthed) return;
  try {
    const body = await api("/tags?page_size=0");
    tagNames = new Map((body.tags || []).map(tag => [String(tag.id), tag.name]));
  } catch (err) { /* non-fatal: chips fall back to empty */ }
}

function renderTagChips(container, tags, onRemove) {
  container.innerHTML = tags.map(tag => {
    const id = String(tag);
    const name = tagNames.get(id);
    if (!name) return "";
    return `
    <span class="tag-chip">${escapeHtml(name)}
      <button type="button" class="tag-remove" data-tag="${escapeHtml(id)}" title="${t("rows.removeTag")}">×</button>
    </span>`;
  }).join("");
  container.querySelectorAll(".tag-remove").forEach(btn => {
    btn.addEventListener("click", () => onRemove(btn.dataset.tag));
  });
}

function renderFormTagChips() {
  renderTagChips(tagChipsEl, formTags, tag => {
    formTags = formTags.filter(t => t !== tag);
    renderFormTagChips();
  });
}

function renderTagFilterChips() {
  tagFilterEl.classList.toggle("hidden", !tagFilter.length);
  renderTagChips(tagFilterChips, tagFilter, tag => {
    tagFilter = tagFilter.filter(t => t !== tag);
    renderTagFilterChips();
    currentPage = 1;
    load();
  });
}

// ---------- Saving ----------

function mediaInfoFor(r) {
  const map = new Map();
  const add = arr => (arr || []).forEach(x => (x.media || []).forEach(m => map.set(m.path, { type: m.type, alt: m.alt })));
  (r.media || []).forEach(m => map.set(m.path, { type: m.type, alt: m.alt }));
  add(r.ingredients);
  add(r.steps);
  add(r.cookware);
  return map;
}

const MAX_IMAGE_BYTES = 200 * 1024;
const TARGET_IMAGE_BYTES = 100 * 1024;
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "webm", "m4v"];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t("status.readImageFailed"))); };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error(t("status.encodeImageFailed")))), "image/jpeg", quality);
  });
}

async function bestJpegBlob(canvas, byteLimit) {
  let lo = 0.05, hi = 1, best = null, smallest = null;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const blob = await canvasToJpegBlob(canvas, mid);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= byteLimit) { best = blob; lo = mid; }
    else hi = mid;
  }
  return best || smallest;
}

async function compressImage(file) {
  if (/^image\/jpeg$/i.test(file.type) && file.size <= MAX_IMAGE_BYTES) return file;
  const img = await loadImage(file);
  const draw = (w, h) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas;
  };
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  let blob = await bestJpegBlob(draw(width, height), TARGET_IMAGE_BYTES);
  let guard = 0;
  while (blob.size > MAX_IMAGE_BYTES && guard++ < 6) {
    const scale = Math.sqrt(TARGET_IMAGE_BYTES / blob.size);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    blob = await bestJpegBlob(draw(width, height), TARGET_IMAGE_BYTES);
  }
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

async function uploadFile(file) {
  const isVideo = file.type.startsWith("video/");
  if (!isVideo && !file.type.startsWith("image/")) return null;
  const fileToUpload = isVideo ? file : await compressImage(file).catch(() => file);
  let ext = (file.name.split(".").pop() || "").toLowerCase();
  if (fileToUpload.type === "image/jpeg") ext = "jpg";
  if (!ALLOWED_EXTS.includes(ext)) {
    setStatus(t("status.uploadFailed", { name: file.name, msg: t("status.unsupportedType") }), true);
    return null;
  }
  let path = `${crypto.randomUUID()}.${ext}`;
  const fd = new FormData();
  fd.append("file", fileToUpload, fileToUpload.name || file.name);
  fd.append("path", path);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const b = await res.json(); if (b && b.error) msg = b.error; } catch (err) {}
      setStatus(t("status.uploadFailed", { name: file.name, msg }), true);
      return null;
    }
    const saved = await res.json().catch(() => null);
    if (saved && saved.path) path = saved.path;
  } catch (err) {
    setStatus(t("status.uploadFailed", { name: file.name, msg: err.message }), true);
    return null;
  }
  return { path, type: isVideo ? "video" : "image", alt: file.name };
}

// Upload all pending files of a row list, filling row.media with the refs
// that go into the recipe payload.
async function uploadRowMedia(rows) {
  for (const row of rows) {
    row.media = [];
    for (const p of row.keptPaths) {
      const info = row.mediaInfo.get(p);
      if (info) row.media.push({ path: p, type: info.type, alt: info.alt });
    }
    for (const file of row.files) {
      const up = await uploadFile(file);
      if (up) row.media.push(up);
    }
  }
}

form.addEventListener("submit", async e => {
  e.preventDefault();

  const title = val(form.title);
  if (!title) { setStatus(t("status.titleRequired"), true); return; }
  const notes = val(form.notes) || null;
  const ingredientRows = readRows("ingredient");
  const stepRows = readRows("step");
  const cookwareRows = readRows("cookware");
  for (const r of ingredientRows) if (!r.amount || !r.name) { setStatus(t("status.ingredientRequired"), true); return; }
  for (const r of stepRows) if (!r.text) { setStatus(t("status.stepRequired"), true); return; }
  for (const r of cookwareRows) if (!r.name) { setStatus(t("status.cookwareRequired"), true); return; }

  setStatus(t("status.saving"));
  const editingId = form.dataset.editingId;
  const oldRecipe = editingId ? recipes.find(x => x.id === editingId) : null;
  const mediaInfo = oldRecipe ? mediaInfoFor(oldRecipe) : new Map();
  for (const row of [...ingredientRows, ...stepRows, ...cookwareRows]) row.mediaInfo = mediaInfo;

  // Upload every new file first; the recipe content is saved in one request.
  await uploadRowMedia(ingredientRows);
  await uploadRowMedia(stepRows);
  await uploadRowMedia(cookwareRows);

  const recipeEntries = [];
  for (const p of Array.from(recipeMediaPreview.querySelectorAll(".media-preview")).map(x => x.dataset.path)) {
    const info = mediaInfo.get(p);
    if (info) recipeEntries.push({ path: p, type: info.type, alt: info.alt });
  }
  for (const file of Array.from(recipeMediaInput.files)) {
    const up = await uploadFile(file);
    if (up) recipeEntries.push(up);
  }

  const payload = {
    title,
    notes,
    tags: [...formTags],
    ingredients: ingredientRows.map(r => ({ section: r.section, amount: r.amount, name: r.name, note: r.note, media: r.media })),
    steps: stepRows.map(r => ({ section: r.section, text: r.text, duration_min: r.duration_min, note: r.note, media: r.media })),
    cookware: cookwareRows.map(r => ({ name: r.name, note: r.note, media: r.media })),
    media: recipeEntries,
  };

  try {
    if (editingId) await api(`/recipes/${editingId}`, { method: "PATCH", body: payload });
    else await api("/recipes", { method: "POST", body: payload });
  } catch (err) {
    setStatus(t("status.saveFailed", { msg: err.message }), true);
    return;
  }

  resetForm();
  closeAddRecipe();
  setStatus(editingId ? t("status.updated") : t("status.saved"));
  await load({ goToFirst: !editingId });
});

// ---------- Rendering ----------

function groupBySection(items) {
  const groups = [];
  for (const item of items) {
    const key = item.section || "";
    let group = groups.find(g => g.key === key);
    if (!group) { group = { key, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups;
}

function mediaGallery(items) {
  if (!items || !items.length) return "";
  return `<div class="media-grid">${items.map(m => m.type === "video"
    ? `<figure class="media-item"><video src="${escapeHtml(m.url || mediaUrl(m.path))}" controls preload="metadata"></video></figure>`
    : `<figure class="media-item"><img src="${escapeHtml(m.url || mediaUrl(m.path))}" alt="${escapeHtml(m.alt || "")}" loading="lazy"></figure>`).join("")}</div>`;
}

function mediaInline(items) {
  if (!items || !items.length) return "";
  return `<span class="media-inline">${items.map(m => m.type === "video"
    ? `<video src="${escapeHtml(m.url || mediaUrl(m.path))}" muted preload="metadata" title="${escapeHtml(m.alt || "")}"></video>`
    : `<img src="${escapeHtml(m.url || mediaUrl(m.path))}" alt="${escapeHtml(m.alt || "")}" loading="lazy">`).join("")}</span>`;
}

function ingredientList(items) {
  return `<ul class="ingredient-list">${groupBySection(items).map(g => `
    ${g.key ? `<li class="section-heading">${escapeHtml(g.key)}</li>` : ""}
    ${g.items.map(i => `<li>${mediaInline(i.media)}<span class="amount">${escapeHtml(i.amount)}</span> ${escapeHtml(i.name)}${i.note ? ` <span class="muted-note">(${escapeHtml(i.note)})</span>` : ""}</li>`).join("")}`).join("")}</ul>`;
}

function cookwareList(items) {
  return `<ul class="cookware-list">${items.map(c => `<li>${mediaInline(c.media)}${escapeHtml(c.name)}${c.note ? ` <span class="muted-note">(${escapeHtml(c.note)})</span>` : ""}</li>`).join("")}</ul>`;
}

function stepsList(items) {
  let n = 0;
  return `<ol class="step-list">${groupBySection(items).map(g => `
    ${g.key ? `<li class="section-heading">${escapeHtml(g.key)}</li>` : ""}
    ${g.items.map(s => {
      n++;
      return `<li>
        <span class="step-num">${n}</span>
        <div class="step-body">
          <p class="step-text">${escapeHtml(s.text)}</p>
          ${s.duration_min ? `<p class="step-duration">${t("recipeDisplay.minutes", { n: s.duration_min })}</p>` : ""}
          ${s.note ? `<p class="step-note">${escapeHtml(s.note)}</p>` : ""}
          ${mediaInline(s.media)}
        </div>
      </li>`;
    }).join("")}`).join("")}</ol>`;
}

function renderPagination(totalPages) {
  const pageBtn = n => `<button type="button" class="page-btn${n === currentPage ? " active" : ""}" data-page="${n}"${n === currentPage ? ' aria-current="page"' : ""}>${n}</button>`;
  const ellipsis = '<span class="page-ellipsis">…</span>';
  const buttons = [
    `<button type="button" class="page-btn nav" data-page="${currentPage - 1}"${currentPage <= 1 ? " disabled" : ""}>${t("pagination.prev")}</button>`,
  ];
  const windowStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  if (windowStart > 1) {
    buttons.push(pageBtn(1));
    if (windowStart > 2) buttons.push(ellipsis);
  }
  for (let i = windowStart; i <= windowEnd; i++) buttons.push(pageBtn(i));
  if (windowEnd < totalPages) {
    if (windowEnd < totalPages - 1) buttons.push(ellipsis);
    buttons.push(pageBtn(totalPages));
  }
  buttons.push(
    `<button type="button" class="page-btn nav" data-page="${currentPage + 1}"${currentPage >= totalPages ? " disabled" : ""}>${t("pagination.next")}</button>`,
  );
  paginationEl.innerHTML = buttons.join("");
}

function tagListFor(r) {
  const tags = Array.isArray(r.meta_info?.tags) ? r.meta_info.tags : [];
  const chips = tags.map(tag => {
    const name = tagNames.get(String(tag));
    return name ? `<span class="tag-chip static">${escapeHtml(name)}</span>` : "";
  }).join("");
  return chips ? `<p class="tag-list">${chips}</p>` : "";
}

function render() {
  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  currentPage = Math.min(currentPage, totalPages);
  const start = Number.isFinite(pageSize) ? (currentPage - 1) * pageSize : 0;
  const end = Number.isFinite(pageSize) ? Math.min(totalCount, start + pageSize) : totalCount;

  countEl.textContent = totalCount
    ? t(totalCount === 1 ? "recipes.countShowing" : "recipes.countShowingMany", { start: start + 1, end, total: totalCount })
    : t("recipes.noRecipes");
  emptyEl.classList.toggle("hidden", recipes.length > 0);
  paginationEl.classList.toggle("hidden", totalPages <= 1);

  list.innerHTML = recipes.map(r => `
    <li class="recipe" data-id="${r.id}">
      <h3>${escapeHtml(r.title)}</h3>
      <p class="meta">${t("recipeDisplay.added", { date: formatDate(r.created_at) })}</p>
      ${tagListFor(r)}
      ${mediaGallery(r.media)}
      ${(r.ingredients || []).length ? `<section><h4>${t("recipeDisplay.ingredients")}</h4>${ingredientList(r.ingredients)}</section>` : ""}
      ${(r.cookware || []).length ? `<section><h4>${t("recipeDisplay.cookware")}</h4>${cookwareList(r.cookware)}</section>` : ""}
      ${(r.steps || []).length ? `<section><h4>${t("recipeDisplay.steps")}</h4>${stepsList(r.steps)}</section>` : ""}
      ${r.notes ? `<p class="notes">${escapeHtml(r.notes)}</p>` : ""}
      ${isEditor ? `
        <div class="actions">
          <button type="button" class="secondary edit" data-id="${r.id}">${t("recipeDisplay.edit")}</button>
          <button type="button" class="secondary add-tags" data-id="${r.id}">${t("recipeDisplay.addTags")}</button>
          <button type="button" class="secondary add-images" data-id="${r.id}">${t("recipeDisplay.addImages")}</button>
          <button type="button" class="delete" data-id="${r.id}">${t("recipeDisplay.delete")}</button>
        </div>
        <input type="file" class="recipe-image-input" data-id="${r.id}" accept="image/*" multiple hidden>
      ` : ""}
    </li>`).join("");

  renderPagination(totalPages);
}

async function load({ goToFirst = false } = {}) {
  if (!isAuthed) return;
  if (goToFirst) currentPage = 1;
  const seq = ++loadSeq;
  setStatus(t("status.loading"));
  await loadTagNames();
  const params = new URLSearchParams();
  const q = searchInput.value.trim();
  if (q) params.set("q", q);
  params.set("sort", sortColumn);
  params.set("dir", sortAscending ? "asc" : "desc");
  params.set("page", String(currentPage));
  params.set("page_size", pageSize === Number.MAX_SAFE_INTEGER ? "0" : String(pageSize));
  if (tagFilter.length) params.set("tags", tagFilter.join(","));
  let body;
  try {
    body = await api(`/recipes?${params.toString()}`);
  } catch (err) {
    if (seq === loadSeq) setStatus(t("status.loadRecipesFailed", { msg: err.message }), true);
    return;
  }
  if (seq !== loadSeq) return;

  totalCount = body.total || 0;
  recipes = body.recipes || [];
  if (recipes.length === 0 && currentPage > 1 && totalCount > 0) {
    currentPage = Math.max(1, Math.ceil(totalCount / pageSize));
    return load();
  }
  render();
  setStatus("");
}

// ---------- List actions ----------

list.addEventListener("click", async e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;
  const r = recipes.find(x => x.id === id);

  if (btn.classList.contains("add-tags")) {
    if (r) openTagPicker("recipe", r);
    return;
  }

  if (btn.classList.contains("add-images")) {
    btn.closest("li").querySelector(".recipe-image-input").click();
    return;
  }

  if (btn.classList.contains("delete")) {
    if (!r || !confirm(t("confirm.moveToBin", { title: r.title }))) return;
    setStatus(t("status.movingToBin"));
    try {
      await api(`/recipes/${id}`, { method: "DELETE" });
      setStatus(t("status.movedToBin"));
    } catch (err) {
      setStatus(t("status.deleteFailed", { msg: err.message }), true);
      return;
    }
    await load();
    return;
  }

  if (btn.classList.contains("edit") && r) {
    populateForm(r);
    openAddRecipe();
    setStatus(t("status.editing"));
    render();
  }
});

list.addEventListener("change", async e => {
  const input = e.target.closest(".recipe-image-input");
  if (!input || !input.files.length) return;
  const id = input.dataset.id;
  if (!id) return;
  const files = Array.from(input.files);
  input.value = "";
  const r = recipes.find(x => x.id === id);
  setStatus(t("status.uploading"));
  const entries = [];
  for (const file of files) {
    const up = await uploadFile(file);
    if (up) entries.push({ type: up.type, path: up.path, alt: up.alt });
  }
  if (entries.length) {
    try {
      await api(`/recipes/${id}/media`, { method: "POST", body: { media: entries } });
    } catch (err) {
      setStatus(t("status.addImageFailed", { msg: err.message }), true);
      return;
    }
  }
  await load();
  setStatus(t("status.imagesAdded"));
});

searchInput.addEventListener("input", () => {
  searchClear.classList.toggle("hidden", searchInput.value.length === 0);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentPage = 1; load(); }, 300);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.classList.add("hidden");
  searchInput.focus();
  clearTimeout(searchTimer);
  currentPage = 1;
  load();
});

pageSizeSelect.addEventListener("change", () => {
  pageSize = pageSizeSelect.value === "0" ? Number.MAX_SAFE_INTEGER : parseInt(pageSizeSelect.value, 10);
  currentPage = 1;
  load();
});

sortSelect.addEventListener("change", () => {
  const [field, dir] = sortSelect.value.split("-");
  sortColumn = field;
  sortAscending = dir === "asc";
  currentPage = 1;
  load();
});

paginationEl.addEventListener("click", e => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.disabled) return;
  currentPage = parseInt(btn.dataset.page, 10);
  load();
  list.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Recycle bin ----------

function renderRecycleBin() {
  recycleBinCount.textContent = binRecipes.length
    ? t(binRecipes.length === 1 ? "bin.countOne" : "bin.count", { n: binRecipes.length })
    : t("bin.empty");
  recycleBinList.innerHTML = binRecipes.map(r => `
    <li class="recycle-bin-item">
      <span class="bin-title">${escapeHtml(r.title)}</span>
      <span class="bin-meta">${t("bin.deleted", { date: formatDate(r.deleted_at) })}</span>
      <span class="bin-actions">
        <button type="button" class="secondary bin-restore" data-id="${escapeHtml(r.id)}">${t("bin.restore")}</button>
        <button type="button" class="danger bin-prune" data-id="${escapeHtml(r.id)}" data-title="${escapeHtml(r.title)}">${t("bin.prune")}</button>
      </span>
    </li>`).join("");
  recycleBinRestoreAll.disabled = !binRecipes.length;
  recycleBinEmpty.disabled = !binRecipes.length;
}

async function loadRecycleBin() {
  if (!isAuthed) return;
  let body;
  try {
    body = await api("/bin");
  } catch (err) {
    setStatus(t("status.loadBinFailed", { msg: err.message }), true);
    return;
  }
  binRecipes = body.recipes || [];
  renderRecycleBin();
}

function openRecycleBin() {
  if (!isEditor) return;
  recycleBin.classList.remove("hidden");
  loadRecycleBin();
}

recycleBinBtn.addEventListener("click", openRecycleBin);
recycleBinClose.addEventListener("click", () => recycleBin.classList.add("hidden"));
recycleBin.addEventListener("click", e => {
  if (e.target === recycleBin) recycleBin.classList.add("hidden");
});

function openLightbox(el) {
  const clone = el.cloneNode(true);
  clone.removeAttribute("loading");
  lightbox.innerHTML = "";
  lightbox.appendChild(clone);
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightbox.innerHTML = "";
}

list.addEventListener("click", e => {
  const media = e.target.closest(".media-item img, .media-item video");
  if (media && media.closest("figure.media-item")) openLightbox(media);
});
lightbox.addEventListener("click", e => {
  if (e.target === lightbox || e.target === lightboxClose) closeLightbox();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeLightbox();
});

recycleBinList.addEventListener("click", async e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const r = binRecipes.find(x => x.id === id);
  if (!r) return;

  if (btn.classList.contains("bin-restore")) {
    try {
      await api(`/recipes/${id}/restore`, { method: "POST" });
    } catch (err) {
      setStatus(t("status.restoreFailed", { msg: err.message }), true);
      return;
    }
    setStatus(t("bin.restored", { title: r.title }));
    loadRecycleBin();
    await load();
    return;
  }

  if (btn.classList.contains("bin-prune")) {
    if (!confirm(t("confirm.prune", { title: r.title }))) return;
    setStatus(t("status.pruning"));
    try {
      // The server removes the recipe row and its photos and videos.
      await api(`/recipes/${id}/purge`, { method: "POST" });
    } catch (err) {
      setStatus(t("status.deleteFailed", { msg: err.message }), true);
      return;
    }
    setStatus(t("bin.deletedForever", { title: r.title }));
    loadRecycleBin();
    await load();
  }
});

recycleBinRestoreAll.addEventListener("click", async () => {
  if (!binRecipes.length) return;
  if (!confirm(t("confirm.restoreAll", { n: binRecipes.length }))) return;
  setStatus(t("status.restoring"));
  try {
    await api("/bin/restore-all", { method: "POST" });
  } catch (err) {
    setStatus(t("status.restoreFailed", { msg: err.message }), true);
    return;
  }
  setStatus(t("status.binRestored"));
  loadRecycleBin();
  await load();
});

recycleBinEmpty.addEventListener("click", async () => {
  if (!binRecipes.length) return;
  if (!confirm(t("confirm.emptyBin", { n: binRecipes.length }))) return;
  setStatus(t("status.emptying"));
  try {
    await api("/bin/empty", { method: "POST" });
  } catch (err) {
    setStatus(t("status.emptyBinFailed", { msg: err.message }), true);
    return;
  }
  binRecipes = [];
  renderRecycleBin();
  setStatus(t("status.binEmptied"));
  await load();
});

// ---------- Tag picker ----------

function renderTagPickerPagination(totalPages) {
  const pageBtn = n => `<button type="button" class="page-btn${n === tagPickerPage ? " active" : ""}" data-page="${n}"${n === tagPickerPage ? ' aria-current="page"' : ""}>${n}</button>`;
  const ellipsis = '<span class="page-ellipsis">…</span>';
  const buttons = [
    `<button type="button" class="page-btn nav" data-page="${tagPickerPage - 1}"${tagPickerPage <= 1 ? " disabled" : ""}>${t("pagination.prev")}</button>`,
  ];
  const windowStart = Math.max(1, Math.min(tagPickerPage - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  if (windowStart > 1) {
    buttons.push(pageBtn(1));
    if (windowStart > 2) buttons.push(ellipsis);
  }
  for (let i = windowStart; i <= windowEnd; i++) buttons.push(pageBtn(i));
  if (windowEnd < totalPages) {
    if (windowEnd < totalPages - 1) buttons.push(ellipsis);
    buttons.push(pageBtn(totalPages));
  }
  buttons.push(
    `<button type="button" class="page-btn nav" data-page="${tagPickerPage + 1}"${tagPickerPage >= totalPages ? " disabled" : ""}>${t("pagination.next")}</button>`,
  );
  tagPickerPagination.innerHTML = buttons.join("");
  tagPickerPagination.classList.toggle("hidden", totalPages <= 1);
}

async function loadTagPicker() {
  if (!isAuthed) return;
  const params = new URLSearchParams();
  if (tagPickerTerm) params.set("q", tagPickerTerm);
  params.set("page", String(tagPickerPage));
  params.set("page_size", String(TAG_PICKER_PAGE_SIZE));
  let body;
  try {
    body = await api(`/tags?${params.toString()}`);
  } catch (err) {
    setStatus(t("status.loadTagsFailed", { msg: err.message }), true);
    return;
  }
  tagPickerTotal = body.total || 0;
  const totalPages = Math.max(1, Math.ceil(tagPickerTotal / TAG_PICKER_PAGE_SIZE));
  if (!(body.tags || []).length && tagPickerPage > 1) {
    tagPickerPage = totalPages;
    return loadTagPicker();
  }
  tagPickerCount.textContent = tagPickerTotal
    ? t(tagPickerTotal === 1 ? "tags.countOne" : "tags.count", { n: tagPickerTotal })
    : t("tags.noTags");
  const names = (body.tags || []).map(tag => tag.name);
  tagPickerList.innerHTML = (body.tags || []).map(tag => `
    <li>
      <label class="tag-picker-item">
        <input type="checkbox" data-tag="${escapeHtml(String(tag.id))}"${tagPickerSelection.has(String(tag.id)) ? " checked" : ""}>
        <span class="tag-name">${escapeHtml(tag.name)}</span>
        <span class="tag-count">${t(tag.recipe_count === 1 ? "tags.recipeCountOne" : "tags.recipeCount", { n: tag.recipe_count })}</span>
        ${isEditor ? `
        <span class="tag-actions">
          <button type="button" class="tag-edit" data-tag-id="${escapeHtml(String(tag.id))}" data-tag-name="${escapeHtml(tag.name)}" title="${t("tags.rename")}" aria-label="${t("tags.rename")}">✎</button>
          <button type="button" class="tag-delete" data-tag-id="${escapeHtml(String(tag.id))}" data-tag-name="${escapeHtml(tag.name)}" title="${t("tags.delete")}" aria-label="${t("tags.delete")}">✕</button>
        </span>
        ` : ""}
      </label>
    </li>`).join("");
  renderTagPickerPagination(totalPages);
  updateTagPickerCreate(names);
}

function renderTagPickerSelected() {
  tagPickerSelected.classList.toggle("hidden", !tagPickerSelection.size);
  renderTagChips(tagPickerSelected, [...tagPickerSelection].sort(), tag => {
    tagPickerSelection.delete(tag);
    syncTagPickerBoxes();
    renderTagPickerSelected();
    updateTagPickerCreate();
  });
}

function syncTagPickerBoxes() {
  tagPickerList.querySelectorAll("input[type=checkbox]").forEach(box => {
    box.checked = tagPickerSelection.has(box.dataset.tag);
  });
}

function updateTagPickerCreate(names) {
  if (!isEditor) { tagPickerCreate.classList.add("hidden"); return; }
  const term = normalizeTag(tagPickerTerm);
  const exactMatch = (names || []).some(n => n === term);
  const selectedNames = [...tagPickerSelection].map(id => tagNames.get(String(id)) || "");
  const show = !!term && !exactMatch && !selectedNames.includes(term);
  tagPickerCreate.classList.toggle("hidden", !show);
  if (show) tagPickerCreate.textContent = t("tags.create", { term: tagPickerTerm.trim() });
}

function openTagPicker(mode, recipe = null) {
  tagPickerMode = mode;
  tagPickerRecipeId = recipe ? recipe.id : null;
  const initial = mode === "form" ? formTags
    : mode === "recipe" ? (Array.isArray(recipe?.meta_info?.tags) ? recipe.meta_info.tags.map(tag => String(tag)) : [])
    : tagFilter;
  tagPickerSelection = new Set(initial);
  tagPickerTerm = "";
  tagPickerPage = 1;
  tagPickerSearch.value = "";
  tagPickerTitle.textContent = mode === "form" ? t("tags.addTags") : mode === "recipe" ? t("tags.manageTags") : t("tags.filterBy");
  renderTagPickerSelected();
  tagPicker.classList.remove("hidden");
  tagPickerSearch.focus();
  loadTagPicker();
}

tagBrowseBtn.addEventListener("click", () => openTagPicker("form"));
tagFilterBtn.addEventListener("click", () => openTagPicker("filter"));
tagPickerClose.addEventListener("click", () => tagPicker.classList.add("hidden"));
tagPicker.addEventListener("click", e => {
  if (e.target === tagPicker) tagPicker.classList.add("hidden");
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    tagPicker.classList.add("hidden");
    recycleBin.classList.add("hidden");
    if (!addRecipeSection.classList.contains("hidden")) discardForm();
  }
});
tagPickerApply.addEventListener("click", async () => {
  const selected = [...tagPickerSelection].sort();
  if (tagPickerMode === "form") {
    formTags = selected;
    renderFormTagChips();
  } else if (tagPickerMode === "recipe") {
    try {
      await api(`/recipes/${tagPickerRecipeId}/tags`, { method: "PUT", body: { tags: selected } });
    } catch (err) {
      tagPicker.classList.add("hidden");
      setStatus(t("status.saveTagsFailed", { msg: err.message }), true);
      return;
    }
    tagPicker.classList.add("hidden");
    await load();
    setStatus(t("status.tagsSaved"));
    return;
  } else {
    tagFilter = selected;
    renderTagFilterChips();
    currentPage = 1;
    load();
  }
  tagPicker.classList.add("hidden");
});
tagPickerCreate.addEventListener("click", async () => {
  const tag = normalizeTag(tagPickerTerm);
  if (!tag) return;
  let created;
  try {
    created = await api("/tags", { method: "POST", body: { name: tag } });
  } catch (err) {
    setStatus(t("status.createTagFailed", { msg: err.message }), true);
    return;
  }
  tagNames.set(String(created.id), created.name);
  tagPickerSelection.add(String(created.id));
  syncTagPickerBoxes();
  renderTagPickerSelected();
  updateTagPickerCreate();
  loadTagPicker();
});
tagFilterClear.addEventListener("click", () => {
  tagFilter = [];
  renderTagFilterChips();
  currentPage = 1;
  load();
});
tagPickerSearch.addEventListener("input", () => {
  clearTimeout(tagPickerSearchTimer);
  tagPickerSearchTimer = setTimeout(() => {
    tagPickerTerm = tagPickerSearch.value.trim();
    tagPickerPage = 1;
    loadTagPicker();
  }, 250);
});
tagPickerList.addEventListener("click", e => {
  const box = e.target.closest("input[type=checkbox]");
  if (box) {
    const tag = box.dataset.tag;
    if (box.checked) tagPickerSelection.add(tag);
    else tagPickerSelection.delete(tag);
    renderTagPickerSelected();
    updateTagPickerCreate();
    return;
  }
  const editBtn = e.target.closest("button.tag-edit");
  if (editBtn) {
    e.preventDefault();
    e.stopPropagation();
    renameTag(editBtn.dataset.tagId, editBtn.dataset.tagName);
    return;
  }
  const delBtn = e.target.closest("button.tag-delete");
  if (delBtn) {
    e.preventDefault();
    e.stopPropagation();
    deleteTag(delBtn.dataset.tagId, delBtn.dataset.tagName);
  }
});

async function renameTag(id, oldName) {
  const input = prompt(t("tags.promptRename"), oldName);
  if (input === null) return;
  const name = normalizeTag(input);
  if (!name) { setStatus(t("status.tagNameEmpty"), true); return; }
  if (name === oldName) return;
  try {
    await api(`/tags/${id}`, { method: "PATCH", body: { name } });
  } catch (err) {
    setStatus(t("status.renameTagFailed", { msg: err.message }), true);
    return;
  }
  tagNames.set(String(id), name);
  loadTagPicker();
  await load();
  setStatus(t("status.tagRenamed"));
}

async function deleteTag(id, name) {
  if (!confirm(t("confirm.deleteTag", { name }))) return;
  setStatus(t("status.deletingTag"));
  try {
    await api(`/tags/${id}`, { method: "DELETE" });
  } catch (err) {
    setStatus(t("status.deleteTagFailed", { msg: err.message }), true);
    return;
  }
  tagNames.delete(String(id));
  tagPickerSelection.delete(String(id));
  formTags = formTags.filter(tag => String(tag) !== String(id));
  tagFilter = tagFilter.filter(tag => String(tag) !== String(id));
  syncTagPickerBoxes();
  renderTagPickerSelected();
  renderFormTagChips();
  renderTagFilterChips();
  loadTagPicker();
  await load();
  setStatus(t("status.tagDeleted"));
}
tagPickerPagination.addEventListener("click", e => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.disabled) return;
  tagPickerPage = parseInt(btn.dataset.page, 10);
  loadTagPicker();
});

// ---------- Back to top ----------

const backToTopBtn = document.querySelector("#back-to-top");

window.addEventListener("scroll", () => {
  backToTopBtn.classList.toggle("hidden", window.scrollY < 400);
}, { passive: true });

backToTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- Authentication ----------

function showAuth() {
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
}

function showApp() {
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
}

// user is {email, role} from the backend, or null when signed out.
function applySession(user) {
  isAuthed = !!user;
  isEditor = !!user && user.role !== "viewer";
  logoutBtn.classList.toggle("hidden", !user);
  refreshBtn.classList.toggle("hidden", !user);
  addRecipeToggle.classList.toggle("hidden", !user || !isEditor);
  recycleBinBtn.classList.toggle("hidden", !user || !isEditor);
  if (!isAuthed || !isEditor) addRecipeSection.classList.add("hidden");
  if (user) {
    showApp();
    load();
  } else {
    recipes = [];
    totalCount = 0;
    binRecipes = [];
    showAuth();
    render();
  }
}

authForm.addEventListener("submit", async e => {
  e.preventDefault();
  authError.classList.add("hidden");
  try {
    const user = await api("/auth/login", {
      method: "POST",
      body: { email: authEmail.value.trim(), password: authPassword.value },
    });
    authForm.reset();
    applySession(user);
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch (err) {}
  applySession(null);
});

refreshBtn.addEventListener("click", () => load());

function openAddRecipe() {
  if (!isEditor) return;
  addRecipeSection.classList.remove("hidden");
  addRecipeToggle.textContent = t("header.close");
  form.querySelector("#title").focus();
}

function closeAddRecipe() {
  resetForm();
  addRecipeSection.classList.add("hidden");
  addRecipeToggle.textContent = t("header.addRecipe");
}

function rowHasContent(row) {
  if (row.querySelector(".media-preview")) return true;
  return Array.from(row.querySelectorAll("input, textarea")).some(i => val(i));
}

function formIsEmpty() {
  if (val(form.title) || val(form.notes)) return false;
  if (formTags.length) return false;
  if (recipeMediaPreview.querySelector(".media-preview")) return false;
  if (recipeMediaInput.files.length) return false;
  for (const k of ["ingredient", "step", "cookware"]) {
    for (const row of editors[k].querySelectorAll(".row")) {
      if (rowHasContent(row)) return false;
    }
  }
  return true;
}

function discardForm() {
  if (!formIsEmpty() && !confirm(t("confirm.discard"))) return;
  closeAddRecipe();
  setStatus("");
}

addRecipeToggle.addEventListener("click", () => {
  if (addRecipeSection.classList.contains("hidden")) openAddRecipe();
  else discardForm();
});

addRecipeSection.addEventListener("click", e => {
  if (e.target === addRecipeSection) discardForm();
});

cancelFormBtn.addEventListener("click", discardForm);

document.addEventListener("languagechange", () => {
  if (isAuthed) load();
  else render();
  if (!addRecipeSection.classList.contains("hidden")) addRecipeToggle.textContent = t("header.close");
  if (!recycleBin.classList.contains("hidden")) loadRecycleBin();
  if (!tagPicker.classList.contains("hidden")) {
    tagPickerTitle.textContent = tagPickerMode === "form" ? t("tags.addTags") : tagPickerMode === "recipe" ? t("tags.manageTags") : t("tags.filterBy");
    loadTagPicker();
  }
});

// Bootstrap: ask the backend whether we already have a valid session cookie.
api("/me").then(applySession).catch(() => applySession(null));

load();
