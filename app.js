const config = window.SUPABASE_URL && window.SUPABASE_ANON_KEY
  ? { url: window.SUPABASE_URL, key: window.SUPABASE_ANON_KEY }
  : null;

const form = document.querySelector("#recipe-form");
const resetFormBtn = document.querySelector("#reset-form");
const searchInput = document.querySelector("#search");
const list = document.querySelector("#recipe-list");
const countEl = document.querySelector("#count");
const emptyEl = document.querySelector("#empty");
const statusEl = document.querySelector("#status");
const banner = document.querySelector("#config-banner");
const pageSizeSelect = document.querySelector("#page-size");
const paginationEl = document.querySelector("#pagination");
const refreshBtn = document.querySelector("#refresh");
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

let isAuthed = false;

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
const TAG_PICKER_PAGE_SIZE = 20;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  if (message) setTimeout(() => { if (statusEl.textContent === message) statusEl.textContent = ""; }, 3000);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function val(input) {
  return input ? input.value.trim() : "";
}

async function signedUrl(path) {
  const { data } = await supabase.storage.from("recipe-media").createSignedUrl(path, 3600);
  return data ? data.signedUrl : "";
}

// ---------- Row-based editors ----------

function rowTemplate(kind, r = {}) {
  const section = `<input class="row-section" placeholder="Section (optional)" value="${escapeHtml(r.section || "")}">`;
  const media = mediaPreviewHtml(r.media || []);
  const file = `<label class="file-label">Add media <input class="row-file" type="file" accept="image/*,video/*" multiple></label>`;
  const actions = `
    <div class="row-actions">
      <button type="button" class="secondary row-up" title="Move up">↑</button>
      <button type="button" class="secondary row-down" title="Move down">↓</button>
      <button type="button" class="danger row-remove" title="Remove">Remove</button>
    </div>`;

  if (kind === "ingredient") {
    return `<div class="row">${section}
      <input class="row-amount" placeholder="Amount (e.g. 2 cloves)" value="${escapeHtml(r.amount || "")}">
      <input class="row-name" placeholder="Ingredient (e.g. garlic)" value="${escapeHtml(r.name || "")}">
      <input class="row-note" placeholder="Note (optional)" value="${escapeHtml(r.note || "")}">
      ${media}${file}${actions}</div>`;
  }
  if (kind === "step") {
    return `<div class="row">${section}
      <textarea class="row-text" placeholder="What to do" rows="2">${escapeHtml(r.text || "")}</textarea>
      <input class="row-duration" type="number" min="0" placeholder="Minutes (optional)" value="${r.duration_min ?? ""}">
      <input class="row-note" placeholder="Note (optional)" value="${escapeHtml(r.note || "")}">
      ${media}${file}${actions}</div>`;
  }
  return `<div class="row">
    <input class="row-name" placeholder="Cookware (e.g. cast-iron skillet)" value="${escapeHtml(r.name || "")}">
    <input class="row-note" placeholder="Note (optional)" value="${escapeHtml(r.note || "")}">
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
  return items.map(m => `
    <figure class="media-preview" data-path="${escapeHtml(m.path)}">
      ${m.type === "video"
        ? `<video src="${escapeHtml(m.signedUrl)}" muted preload="metadata"></video>`
        : `<img src="${escapeHtml(m.signedUrl)}" alt="${escapeHtml(m.alt || "")}" loading="lazy">`}
      <button type="button" class="remove-media" title="Remove">×</button>
    </figure>`).join("");
}

function populateEditor(kind, rows) {
  editors[kind].innerHTML = (rows || []).map(r => rowTemplate(kind, r)).join("");
}

function populateForm(r) {
  form.title.value = r.title;
  form.notes.value = r.notes || "";
  formTags = Array.isArray(r.meta_info?.tags) ? r.meta_info.tags.map(t => String(t)) : [];
  renderFormTagChips();
  populateEditor("ingredient", r.ingredients);
  populateEditor("step", r.steps);
  populateEditor("cookware", r.cookware);
  recipeMediaPreview.innerHTML = mediaPreviewHtml(r.media || []);
  form.dataset.editingId = r.id;
  form.querySelector("button[type=submit]").textContent = "Update recipe";
  resetFormBtn.textContent = "Cancel";
}

function resetForm() {
  form.reset();
  delete form.dataset.editingId;
  ["ingredient", "step", "cookware"].forEach(k => { editors[k].innerHTML = ""; });
  recipeMediaPreview.innerHTML = "";
  formTags = [];
  renderFormTagChips();
  form.querySelector("button[type=submit]").textContent = "Save recipe";
  resetFormBtn.textContent = "Clear";
}

// ---------- Tags ----------

function normalizeTag(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadTagNames() {
  if (!config || !isAuthed) return;
  const { data, error } = await supabase.from("tags").select("id, name");
  if (!error) tagNames = new Map((data || []).map(t => [String(t.id), t.name]));
}

function renderTagChips(container, tags, onRemove) {
  container.innerHTML = tags.map(t => {
    const id = String(t);
    const name = tagNames.get(id);
    if (!name) return "";
    return `
    <span class="tag-chip">${escapeHtml(name)}
      <button type="button" class="tag-remove" data-tag="${escapeHtml(id)}" title="Remove tag">×</button>
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

function applyTagFilter(query) {
  return tagFilter.length ? query.contains("meta_info", { tags: tagFilter }) : query;
}

// ---------- Saving ----------

function flatMedia(r) {
  const out = (r.media || []).map(m => m.path);
  [r.ingredients, r.steps, r.cookware].forEach(arr =>
    (arr || []).forEach(x => (x.media || []).forEach(m => out.push(m.path))));
  return out;
}

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

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image.")); };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Could not encode image."))), "image/jpeg", quality);
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
  const ext = fileToUpload.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("recipe-media").upload(path, fileToUpload);
  if (error) { setStatus(`Failed to upload ${file.name}: ${error.message}`, true); return null; }
  return { path, type: isVideo ? "video" : "image", alt: file.name };
}

async function saveEntities(kind, rows, recipeId, mediaInfo) {
  const created = [];
  let position = 0;
  for (const row of rows) {
    const record = kind === "ingredient"
      ? { recipe_id: recipeId, position, section: row.section, amount: row.amount, name: row.name, note: row.note }
      : kind === "step"
        ? { recipe_id: recipeId, position, section: row.section, text: row.text, duration_min: row.duration_min, notes: row.note }
        : { recipe_id: recipeId, position, name: row.name, note: row.note };
    const { data, error } = await supabase.from(kind + "s").insert(record).select();
    if (error) { setStatus(`Failed to save ${kind}: ${error.message}`, true); continue; }
    const entityId = data[0].id;

    const entries = [];
    for (const p of row.keptPaths) {
      const info = mediaInfo.get(p);
      if (info) entries.push({ path: p, ...info });
    }
    for (const file of row.files) {
      const up = await uploadFile(file);
      if (up) entries.push(up);
    }

    let sort = 0;
    for (const m of entries) {
      const target = kind === "ingredient" ? { ingredient_id: entityId }
        : kind === "step" ? { step_id: entityId }
        : { cookware_id: entityId };
      const { error: mErr } = await supabase.from("media").insert({ ...target, type: m.type, path: m.path, alt: m.alt, sort_order: sort++ });
      if (mErr) setStatus("Failed to save media info: " + mErr.message, true);
      else created.push(m.path);
    }
    position++;
  }
  return created;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!config) { setStatus("Database not configured — see config.js", true); return; }

  const title = val(form.title);
  if (!title) { setStatus("Title is required.", true); return; }
  const notes = val(form.notes) || null;
  const ingredientRows = readRows("ingredient");
  const stepRows = readRows("step");
  const cookwareRows = readRows("cookware");
  for (const r of ingredientRows) if (!r.amount || !r.name) { setStatus("Each ingredient needs an amount and a name.", true); return; }
  for (const r of stepRows) if (!r.text) { setStatus("Every step needs instructions.", true); return; }
  for (const r of cookwareRows) if (!r.name) { setStatus("Every cookware item needs a name.", true); return; }

  const tags = [...formTags];

  setStatus("Saving…");
  const editingId = form.dataset.editingId;
  const oldRecipe = editingId ? recipes.find(x => x.id === editingId) : null;
  const oldPaths = oldRecipe ? flatMedia(oldRecipe) : [];
  const mediaInfo = oldRecipe ? mediaInfoFor(oldRecipe) : new Map();

  let recipeId = editingId;
  if (recipeId) {
    const { error } = await supabase.from("recipes").update({ title, notes, meta_info: { ...(oldRecipe?.meta_info || {}), tags } }).eq("id", recipeId);
    if (error) { setStatus("Failed to save: " + error.message, true); return; }
  } else {
    const { data, error } = await supabase.from("recipes").insert({ title, notes, meta_info: { tags } }).select();
    if (error) { setStatus("Failed to save: " + error.message, true); return; }
    recipeId = data[0].id;
  }

  if (editingId) {
    await supabase.from("media").delete().eq("recipe_id", recipeId);
    await supabase.from("ingredients").delete().eq("recipe_id", recipeId);
    await supabase.from("steps").delete().eq("recipe_id", recipeId);
    await supabase.from("cookware").delete().eq("recipe_id", recipeId);
  }

  const newPaths = new Set();
  (await saveEntities("ingredient", ingredientRows, recipeId, mediaInfo)).forEach(p => newPaths.add(p));
  (await saveEntities("step", stepRows, recipeId, mediaInfo)).forEach(p => newPaths.add(p));
  (await saveEntities("cookware", cookwareRows, recipeId, mediaInfo)).forEach(p => newPaths.add(p));

  const keptRecipe = Array.from(recipeMediaPreview.querySelectorAll(".media-preview")).map(p => p.dataset.path);
  const recipeEntries = [];
  for (const p of keptRecipe) {
    const info = mediaInfo.get(p);
    if (info) recipeEntries.push({ path: p, ...info });
  }
  for (const file of Array.from(recipeMediaInput.files)) {
    const up = await uploadFile(file);
    if (up) recipeEntries.push(up);
  }
  let sort = 0;
  for (const m of recipeEntries) {
    const { error } = await supabase.from("media").insert({ recipe_id: recipeId, type: m.type, path: m.path, alt: m.alt, sort_order: sort++ });
    if (error) { setStatus("Failed to save media info: " + error.message, true); continue; }
    newPaths.add(m.path);
  }

  const removed = oldPaths.filter(p => !newPaths.has(p));
  if (removed.length) await supabase.storage.from("recipe-media").remove(removed);

  resetForm();
  setStatus(editingId ? "Recipe updated." : "Recipe saved.");
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
    ? `<figure class="media-item"><video src="${escapeHtml(m.signedUrl)}" controls preload="metadata"></video></figure>`
    : `<figure class="media-item"><img src="${escapeHtml(m.signedUrl)}" alt="${escapeHtml(m.alt || "")}" loading="lazy"></figure>`).join("")}</div>`;
}

function mediaInline(items) {
  if (!items || !items.length) return "";
  return `<span class="media-inline">${items.map(m => m.type === "video"
    ? `<video src="${escapeHtml(m.signedUrl)}" muted preload="metadata" title="${escapeHtml(m.alt || "")}"></video>`
    : `<img src="${escapeHtml(m.signedUrl)}" alt="${escapeHtml(m.alt || "")}" loading="lazy">`).join("")}</span>`;
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
          ${s.duration_min ? `<p class="step-duration">${s.duration_min} min</p>` : ""}
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
    `<button type="button" class="page-btn nav" data-page="${currentPage - 1}"${currentPage <= 1 ? " disabled" : ""}>Prev</button>`,
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
    `<button type="button" class="page-btn nav" data-page="${currentPage + 1}"${currentPage >= totalPages ? " disabled" : ""}>Next</button>`,
  );
  paginationEl.innerHTML = buttons.join("");
}

function tagListFor(r) {
  const tags = Array.isArray(r.meta_info?.tags) ? r.meta_info.tags : [];
  const chips = tags.map(t => {
    const name = tagNames.get(String(t));
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
    ? `Showing ${start + 1}–${end} of ${totalCount} recipe${totalCount === 1 ? "" : "s"}`
    : "No recipes";
  emptyEl.classList.toggle("hidden", recipes.length > 0);
  paginationEl.classList.toggle("hidden", totalPages <= 1);

  list.innerHTML = recipes.map(r => `
    <li class="recipe" data-id="${r.id}">
      <h3>${escapeHtml(r.title)}</h3>
      <p class="meta">Added ${formatDate(r.created_at)}</p>
      ${tagListFor(r)}
      ${mediaGallery(r.media)}
      ${(r.ingredients || []).length ? `<section><h4>Ingredients</h4>${ingredientList(r.ingredients)}</section>` : ""}
      ${(r.cookware || []).length ? `<section><h4>Cookware</h4>${cookwareList(r.cookware)}</section>` : ""}
      ${(r.steps || []).length ? `<section><h4>Steps</h4>${stepsList(r.steps)}</section>` : ""}
      ${r.notes ? `<p class="notes">${escapeHtml(r.notes)}</p>` : ""}
      <div class="actions">
        <button type="button" class="secondary edit" data-id="${r.id}">Edit</button>
        <button type="button" class="secondary add-tags" data-id="${r.id}">Add tags</button>
        <button type="button" class="secondary add-images" data-id="${r.id}">Add images</button>
        <button type="button" class="delete" data-id="${r.id}">Delete</button>
      </div>
      <input type="file" class="recipe-image-input" data-id="${r.id}" accept="image/*" multiple hidden>
    </li>`).join("");

  renderPagination(totalPages);
}

async function attachSignedUrls(r) {
  const withUrl = async m => { m.signedUrl = await signedUrl(m.path); };
  for (const m of r.media || []) await withUrl(m);
  for (const arr of [r.ingredients, r.steps, r.cookware]) {
    for (const item of arr || []) for (const m of item.media || []) await withUrl(m);
  }
}

function escapeLike(term) {
  return term.replace(/,/g, "%2C").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function applySearch(q, query) {
  if (!q) return query;
  const safe = escapeLike(q);
  return query.or(`title.ilike.%${safe}%,notes.ilike.%${safe}%`);
}

async function load({ goToFirst = false } = {}) {
  if (!config || !isAuthed) return;
  if (goToFirst) currentPage = 1;
  const seq = ++loadSeq;
  setStatus("Loading…");
  await loadTagNames();
  const q = searchInput.value.trim();
  const start = (currentPage - 1) * pageSize;

  const countQuery = applyTagFilter(applySearch(q, supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })));
  let dataQuery = applyTagFilter(applySearch(q, supabase
    .from("recipes")
    .select("*, ingredients(*, media(*)), steps(*, media(*)), cookware(*, media(*)), media(*)")
    .order("created_at", { ascending: false })));
  if (Number.isFinite(pageSize)) dataQuery = dataQuery.range(start, start + pageSize - 1);

  const [{ count, error: countError }, { data, error }] = await Promise.all([countQuery, dataQuery]);
  if (seq !== loadSeq) return;
  if (countError || error) { setStatus("Failed to load recipes: " + (countError || error).message, true); return; }

  totalCount = count || 0;
  recipes = (data || []).map(r => ({
    ...r,
    ingredients: (r.ingredients || []).sort((a, b) => a.position - b.position),
    steps: (r.steps || []).sort((a, b) => a.position - b.position),
    cookware: (r.cookware || []).sort((a, b) => a.position - b.position),
    media: (r.media || []).sort((a, b) => a.sort_order - b.sort_order),
  }));
  if (recipes.length === 0 && currentPage > 1 && totalCount > 0) {
    currentPage = Math.max(1, Math.ceil(totalCount / pageSize));
    return load();
  }
  for (const r of recipes) await attachSignedUrls(r);
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
    if (!r || !confirm("Delete this recipe and all its media?")) return;
    setStatus("Deleting…");
    const paths = flatMedia(r);
    if (paths.length) await supabase.storage.from("recipe-media").remove(paths);
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) { setStatus("Failed to delete: " + error.message, true); return; }
    setStatus("Recipe deleted.");
    await load();
    return;
  }

  if (btn.classList.contains("edit") && r) {
    populateForm(r);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.querySelector("#title").focus();
    setStatus("Editing — make changes and save.");
    render();
  }
});

resetFormBtn.addEventListener("click", () => {
  resetForm();
  setStatus("");
});

list.addEventListener("change", async e => {
  const input = e.target.closest(".recipe-image-input");
  if (!input || !input.files.length) return;
  const id = input.dataset.id;
  if (!id) return;
  const files = Array.from(input.files);
  input.value = "";
  const r = recipes.find(x => x.id === id);
  let sort = (r?.media || []).reduce((m, x) => Math.max(m, x.sort_order ?? 0), -1) + 1;
  setStatus("Uploading…");
  for (const file of files) {
    const up = await uploadFile(file);
    if (!up) continue;
    const { error } = await supabase.from("media").insert({ recipe_id: id, type: up.type, path: up.path, alt: up.alt, sort_order: sort++ });
    if (error) { setStatus("Failed to add image: " + error.message, true); continue; }
  }
  await load();
  setStatus("Images added.");
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentPage = 1; load(); }, 300);
});

pageSizeSelect.addEventListener("change", () => {
  pageSize = pageSizeSelect.value === "0" ? Number.MAX_SAFE_INTEGER : parseInt(pageSizeSelect.value, 10);
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

// ---------- Tag picker ----------

function renderTagPickerPagination(totalPages) {
  const pageBtn = n => `<button type="button" class="page-btn${n === tagPickerPage ? " active" : ""}" data-page="${n}"${n === tagPickerPage ? ' aria-current="page"' : ""}>${n}</button>`;
  const ellipsis = '<span class="page-ellipsis">…</span>';
  const buttons = [
    `<button type="button" class="page-btn nav" data-page="${tagPickerPage - 1}"${tagPickerPage <= 1 ? " disabled" : ""}>Prev</button>`,
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
    `<button type="button" class="page-btn nav" data-page="${tagPickerPage + 1}"${tagPickerPage >= totalPages ? " disabled" : ""}>Next</button>`,
  );
  tagPickerPagination.innerHTML = buttons.join("");
  tagPickerPagination.classList.toggle("hidden", totalPages <= 1);
}

async function loadTagPicker() {
  if (!config || !isAuthed) return;
  let query = supabase
    .from("tag_stats")
    .select("id, name, recipe_count", { count: "exact" })
    .order("name", { ascending: true });
  if (tagPickerTerm) query = query.ilike("name", `%${escapeLike(tagPickerTerm)}%`);
  const start = (tagPickerPage - 1) * TAG_PICKER_PAGE_SIZE;
  const { count, data, error } = await query.range(start, start + TAG_PICKER_PAGE_SIZE - 1);
  if (error) { setStatus("Failed to load tags: " + error.message, true); return; }
  tagPickerTotal = count || 0;
  const totalPages = Math.max(1, Math.ceil(tagPickerTotal / TAG_PICKER_PAGE_SIZE));
  if (!(data || []).length && tagPickerPage > 1) {
    tagPickerPage = totalPages;
    return loadTagPicker();
  }
  tagPickerCount.textContent = tagPickerTotal
    ? `${tagPickerTotal} tag${tagPickerTotal === 1 ? "" : "s"}`
    : "No tags";
  const names = (data || []).map(t => t.name);
  tagPickerList.innerHTML = (data || []).map(t => `
    <li>
      <label class="tag-picker-item">
        <input type="checkbox" data-tag="${escapeHtml(String(t.id))}"${tagPickerSelection.has(String(t.id)) ? " checked" : ""}>
        <span class="tag-name">${escapeHtml(t.name)}</span>
        <span class="tag-count">${t.recipe_count} recipe${t.recipe_count === 1 ? "" : "s"}</span>
        <span class="tag-actions">
          <button type="button" class="tag-edit" data-tag-id="${escapeHtml(String(t.id))}" data-tag-name="${escapeHtml(t.name)}" title="Rename tag" aria-label="Rename tag">✎</button>
          <button type="button" class="tag-delete" data-tag-id="${escapeHtml(String(t.id))}" data-tag-name="${escapeHtml(t.name)}" title="Delete tag" aria-label="Delete tag">✕</button>
        </span>
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
  const term = normalizeTag(tagPickerTerm);
  const exactMatch = (names || []).some(n => n === term);
  const selectedNames = [...tagPickerSelection].map(id => tagNames.get(String(id)) || "");
  const show = !!term && !exactMatch && !selectedNames.includes(term);
  tagPickerCreate.classList.toggle("hidden", !show);
  if (show) tagPickerCreate.textContent = `+ Create tag “${tagPickerTerm.trim()}”`;
}

function openTagPicker(mode, recipe = null) {
  tagPickerMode = mode;
  tagPickerRecipeId = recipe ? recipe.id : null;
  const initial = mode === "form" ? formTags
    : mode === "recipe" ? (Array.isArray(recipe?.meta_info?.tags) ? recipe.meta_info.tags.map(t => String(t)) : [])
    : tagFilter;
  tagPickerSelection = new Set(initial);
  tagPickerTerm = "";
  tagPickerPage = 1;
  tagPickerSearch.value = "";
  tagPickerTitle.textContent = mode === "form" ? "Add tags" : mode === "recipe" ? "Manage tags" : "Filter by tags";
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
  if (e.key === "Escape") tagPicker.classList.add("hidden");
});
tagPickerApply.addEventListener("click", async () => {
  const selected = [...tagPickerSelection].sort();
  if (tagPickerMode === "form") {
    formTags = selected;
    renderFormTagChips();
  } else if (tagPickerMode === "recipe") {
    const current = recipes.find(x => x.id === tagPickerRecipeId);
    const { error } = await supabase.from("recipes")
      .update({ meta_info: { ...(current?.meta_info || {}), tags: selected } })
      .eq("id", tagPickerRecipeId);
    tagPicker.classList.add("hidden");
    if (error) { setStatus("Failed to save tags: " + error.message, true); return; }
    await load();
    setStatus("Tags saved.");
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
  const { data, error } = await supabase.from("tags")
    .upsert([{ name: tag }], { onConflict: "name" }).select().single();
  if (error) { setStatus("Failed to create tag: " + error.message, true); return; }
  tagNames.set(String(data.id), data.name);
  tagPickerSelection.add(String(data.id));
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
  const input = prompt("Rename tag", oldName);
  if (input === null) return;
  const name = normalizeTag(input);
  if (!name) { setStatus("Tag name cannot be empty.", true); return; }
  if (name === oldName) return;
  const { data: existing } = await supabase.from("tags").select("id").eq("name", name).maybeSingle();
  if (existing) { setStatus("A tag with that name already exists.", true); return; }
  const { error } = await supabase.from("tags").update({ name }).eq("id", id);
  if (error) { setStatus("Failed to rename tag: " + error.message, true); return; }
  tagNames.set(String(id), name);
  loadTagPicker();
  await load();
  setStatus("Tag renamed.");
}

async function deleteTag(id, name) {
  if (!confirm(`Delete tag "${name}"? It will no longer be shown on recipes.`)) return;
  setStatus("Deleting tag…");
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) { setStatus("Failed to delete tag: " + error.message, true); return; }
  tagNames.delete(String(id));
  tagPickerSelection.delete(String(id));
  formTags = formTags.filter(t => String(t) !== String(id));
  tagFilter = tagFilter.filter(t => String(t) !== String(id));
  syncTagPickerBoxes();
  renderTagPickerSelected();
  renderFormTagChips();
  renderTagFilterChips();
  loadTagPicker();
  await load();
  setStatus("Tag deleted.");
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

function applySession(session) {
  isAuthed = !!session;
  logoutBtn.classList.toggle("hidden", !session);
  refreshBtn.classList.toggle("hidden", !session);
  if (session) {
    showApp();
    load();
  } else {
    recipes = [];
    totalCount = 0;
    showAuth();
    render();
  }
}

authForm.addEventListener("submit", async e => {
  e.preventDefault();
  authError.classList.add("hidden");
  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail.value.trim(),
    password: authPassword.value,
  });
  if (error) { authError.textContent = error.message; authError.classList.remove("hidden"); return; }
  authForm.reset();
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

refreshBtn.addEventListener("click", () => load());

if (config) {
  supabase = window.supabase.createClient(config.url, config.key);
  supabase.auth.getSession().then(({ data }) => applySession(data.session));
  supabase.auth.onAuthStateChange((_event, session) => applySession(session));
} else {
  banner.classList.remove("hidden");
  showApp();
  render();
}

load();
