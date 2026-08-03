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

const editors = {
  ingredient: document.querySelector("#ingredients-editor"),
  step: document.querySelector("#steps-editor"),
  cookware: document.querySelector("#cookware-editor"),
};
const recipeMediaInput = document.querySelector("#recipe-media");
const recipeMediaPreview = document.querySelector("#recipe-media-preview");

let recipes = [];

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

function mediaUrl(path) {
  return supabase.storage.from("recipe-media").getPublicUrl(path).data.publicUrl;
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

function seedEmptyRows() {
  addRow("ingredient");
  addRow("step");
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
        ? `<video src="${escapeHtml(mediaUrl(m.path))}" muted preload="metadata"></video>`
        : `<img src="${escapeHtml(mediaUrl(m.path))}" alt="${escapeHtml(m.alt || "")}" loading="lazy">`}
      <button type="button" class="remove-media" title="Remove">×</button>
    </figure>`).join("");
}

function populateEditor(kind, rows) {
  editors[kind].innerHTML = (rows || []).map(r => rowTemplate(kind, r)).join("");
}

function populateForm(r) {
  form.title.value = r.title;
  form.notes.value = r.notes || "";
  populateEditor("ingredient", r.ingredients);
  populateEditor("step", r.steps);
  populateEditor("cookware", r.cookware);
  recipeMediaPreview.innerHTML = mediaPreviewHtml(r.media || []);
  form.dataset.editingId = r.id;
  form.querySelector("button[type=submit]").textContent = "Update recipe";
}

function resetForm() {
  form.reset();
  delete form.dataset.editingId;
  ["ingredient", "step", "cookware"].forEach(k => { editors[k].innerHTML = ""; });
  recipeMediaPreview.innerHTML = "";
  form.querySelector("button[type=submit]").textContent = "Save recipe";
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

async function uploadFile(file) {
  const isVideo = file.type.startsWith("video/");
  if (!isVideo && !file.type.startsWith("image/")) return null;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("recipe-media").upload(path, file);
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
  if (!ingredientRows.length) { setStatus("Add at least one ingredient.", true); return; }
  if (!stepRows.length) { setStatus("Add at least one step.", true); return; }
  for (const r of ingredientRows) if (!r.amount || !r.name) { setStatus("Each ingredient needs an amount and a name.", true); return; }
  for (const r of stepRows) if (!r.text) { setStatus("Every step needs instructions.", true); return; }
  for (const r of cookwareRows) if (!r.name) { setStatus("Every cookware item needs a name.", true); return; }

  setStatus("Saving…");
  const editingId = form.dataset.editingId;
  const oldRecipe = editingId ? recipes.find(x => x.id === editingId) : null;
  const oldPaths = oldRecipe ? flatMedia(oldRecipe) : [];
  const mediaInfo = oldRecipe ? mediaInfoFor(oldRecipe) : new Map();

  let recipeId = editingId;
  if (recipeId) {
    const { error } = await supabase.from("recipes").update({ title, notes }).eq("id", recipeId);
    if (error) { setStatus("Failed to save: " + error.message, true); return; }
  } else {
    const { data, error } = await supabase.from("recipes").insert({ title, notes }).select();
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
  seedEmptyRows();
  setStatus(editingId ? "Recipe updated." : "Recipe saved.");
  await load();
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
    ? `<figure class="media-item"><video src="${escapeHtml(mediaUrl(m.path))}" controls preload="metadata"></video></figure>`
    : `<figure class="media-item"><img src="${escapeHtml(mediaUrl(m.path))}" alt="${escapeHtml(m.alt || "")}" loading="lazy"></figure>`).join("")}</div>`;
}

function mediaInline(items) {
  if (!items || !items.length) return "";
  return `<span class="media-inline">${items.map(m => m.type === "video"
    ? `<video src="${escapeHtml(mediaUrl(m.path))}" muted preload="metadata" title="${escapeHtml(m.alt || "")}"></video>`
    : `<img src="${escapeHtml(mediaUrl(m.path))}" alt="${escapeHtml(m.alt || "")}" loading="lazy">`).join("")}</span>`;
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

function matches(r, q) {
  const haystack = [r.title, r.notes];
  (r.ingredients || []).forEach(i => haystack.push(i.amount, i.name, i.note));
  (r.steps || []).forEach(s => haystack.push(s.text, s.notes, s.section));
  (r.cookware || []).forEach(c => haystack.push(c.name, c.note));
  (r.media || []).forEach(m => haystack.push(m.alt));
  return haystack.join(" ").toLowerCase().includes(q);
}

function render() {
  const q = searchInput.value.trim().toLowerCase();
  const shown = q ? recipes.filter(r => matches(r, q)) : recipes;

  countEl.textContent = `${shown.length} of ${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`;
  emptyEl.classList.toggle("hidden", shown.length > 0);

  list.innerHTML = shown.map(r => `
    <li class="recipe" data-id="${r.id}">
      <h3>${escapeHtml(r.title)}</h3>
      <p class="meta">Added ${formatDate(r.created_at)}</p>
      ${mediaGallery(r.media)}
      ${(r.ingredients || []).length ? `<section><h4>Ingredients</h4>${ingredientList(r.ingredients)}</section>` : ""}
      ${(r.cookware || []).length ? `<section><h4>Cookware</h4>${cookwareList(r.cookware)}</section>` : ""}
      ${(r.steps || []).length ? `<section><h4>Steps</h4>${stepsList(r.steps)}</section>` : ""}
      ${r.notes ? `<p class="notes">${escapeHtml(r.notes)}</p>` : ""}
      <div class="actions">
        <button type="button" class="secondary edit" data-id="${r.id}">Edit</button>
        <button type="button" class="delete" data-id="${r.id}">Delete</button>
      </div>
    </li>`).join("");
}

async function load() {
  if (!config) return;
  setStatus("Loading…");
  const { data, error } = await supabase
    .from("recipes")
    .select("*, ingredients(*, media(*)), steps(*, media(*)), cookware(*, media(*)), media(*)")
    .order("created_at", { ascending: false });
  if (error) { setStatus("Failed to load recipes: " + error.message, true); return; }
  recipes = (data || []).map(r => ({
    ...r,
    ingredients: (r.ingredients || []).sort((a, b) => a.position - b.position),
    steps: (r.steps || []).sort((a, b) => a.position - b.position),
    cookware: (r.cookware || []).sort((a, b) => a.position - b.position),
    media: (r.media || []).sort((a, b) => a.sort_order - b.sort_order),
  }));
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
  seedEmptyRows();
  setStatus("");
});

searchInput.addEventListener("input", render);

if (config) {
  supabase = window.supabase.createClient(config.url, config.key);
} else {
  banner.classList.remove("hidden");
}

seedEmptyRows();
load();
render();
