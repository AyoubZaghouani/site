/* ==========================================================================
   NOOH Boutique Admin — Supabase Auth + Inventory CRUD (vanilla JS)
   Requires: Supabase JS SDK v2 (CDN) loaded before this file.
   Expected table 'articles': id, title, description, price, stock, image_url, created_at
   Expected storage bucket: 'article-images'
   ========================================================================== */

let adminSupabase = null;
const IMAGE_BUCKET = "article-images";
const ARTICLES_TABLE = "articles";

async function initSupabaseClient() {
  if (adminSupabase) return adminSupabase;
  const response = await fetch("/.netlify/functions/supabase-config");
  if (!response.ok) throw new Error("Failed to load Supabase config");
  const { url, anonKey } = await response.json();
  adminSupabase = window.supabase.createClient(url, anonKey);
  return adminSupabase;
}

const $ = (id) => document.getElementById(id);

const loginView = $("admin-login-view");
const dashboard = $("admin-dashboard");
const loginForm = $("admin-login-form");
const loginError = $("login-error");
const logoutBtn = $("logout-btn");
const addForm = $("add-article-form");
const inventoryList = $("inventory-list");
const toastContainer = $("toast-container");

let articles = [];

/* ── Utilities ── */
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function showToast(msg, isError = false) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i class="fa-solid ${isError ? "fa-triangle-exclamation" : "fa-sparkles"}"></i><span>${escapeHtml(msg)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function setSubmitBtn(btn, loading, idleHtml) {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<i class="fa-solid fa-spinner fa-spin"></i> <span>جارٍ الحفظ…</span>'
    : idleHtml;
}

/* ── Session / UI state ── */
async function checkSession() {
  await initSupabaseClient();
  const {
    data: { session },
  } = await adminSupabase.auth.getSession();
  if (session?.user) showDashboard(session.user);
  else showLogin();
}

function showLogin() {
  loginView.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function showDashboard(user) {
  loginView.classList.add("hidden");
  dashboard.classList.remove("hidden");
  $("admin-user-email").textContent = user.email || "";
  loadArticles();
}

function togglePasswordVisibility(button) {
  const input = document.getElementById(button.dataset.toggleFor);
  if (!input) return;

  const isPasswordHidden = input.type === "password";
  input.type = isPasswordHidden ? "text" : "password";

  const icon = button.querySelector("i");
  if (icon) {
    icon.classList.toggle("fa-eye", !isPasswordHidden);
    icon.classList.toggle("fa-eye-slash", isPasswordHidden);
  }

  button.setAttribute(
    "aria-label",
    isPasswordHidden ? "إخفاء كلمة المرور" : "عرض كلمة المرور",
  );
}

document.addEventListener("click", (event) => {
  const toggleButton = event.target.closest(".admin-password-toggle");
  if (!toggleButton) return;
  togglePasswordVisibility(toggleButton);
});

/* ── Authentication ── */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const btn = loginForm.querySelector("button[type='submit']");
  setSubmitBtn(
    btn,
    true,
    '<i class="fa-solid fa-lock"></i> <span>تسجيل الدخول</span>',
  );
  const { data, error } = await adminSupabase.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-password").value,
  });
  if (error) {
    loginError.textContent = error.message;
    setSubmitBtn(
      btn,
      false,
      '<i class="fa-solid fa-lock"></i> <span>تسجيل الدخول</span>',
    );
    return;
  }
  showToast("مرحباً بك في لوحة التحكم");
  showDashboard(data.user);
});

logoutBtn.addEventListener("click", async () => {
  await initSupabaseClient();
  await adminSupabase.auth.signOut();
  loginForm.reset();
  loginError.textContent = "";
  showLogin();
  showToast("تم تسجيل الخروج");
});

/* ── Image upload ── */
async function uploadImage(file) {
  await initSupabaseClient();
  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await adminSupabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = adminSupabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/* ── Create ── */
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("article-title").value.trim();
  const description = $("article-description").value.trim();
  const price = parseFloat($("article-price").value);
  const stock = parseInt($("article-stock").value, 10);
  const file = $("article-image").files[0];

  if (!title || isNaN(price) || isNaN(stock)) {
    showToast("يرجى إدخال العنوان والسعر والكمية", true);
    return;
  }
  if (!file) {
    showToast("يرجى اختيار صورة للقطعة", true);
    return;
  }

  const btn = addForm.querySelector("button[type='submit']");
  setSubmitBtn(
    btn,
    true,
    '<i class="fa-solid fa-plus"></i> <span>إضافة القطعة</span>',
  );
  try {
    await initSupabaseClient();
    const imageUrl = await uploadImage(file);
    const { data, error } = await adminSupabase
      .from(ARTICLES_TABLE)
      .insert({
        title,
        description,
        price,
        stock,
        image_url: imageUrl,
      })
      .select()
      .single();
    if (error) throw error;
    showToast("تمت إضافة القطعة بنجاح");
    addForm.reset();
    $("image-filename").textContent = "";
    $("image-preview").classList.add("hidden");
    articles.unshift(data);
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast("حدث خطأ أثناء الإضافة: " + (err.message || err), true);
  } finally {
    setSubmitBtn(
      btn,
      false,
      '<i class="fa-solid fa-plus"></i> <span>إضافة القطعة</span>',
    );
  }
});

/* ── Read ── */
async function loadArticles() {
  await initSupabaseClient();
  inventoryList.innerHTML =
    '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> <span>جارٍ تحميل المخزون…</span></div>';
  const { data, error } = await adminSupabase
    .from(ARTICLES_TABLE)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    inventoryList.innerHTML = "";
    showToast("تعذّر تحميل المخزون: " + error.message, true);
    return;
  }
  articles = data || [];
  renderInventory();
}

function renderInventory() {
  $("inventory-count").textContent = `${articles.length} قطعة`;
  if (articles.length === 0) {
    inventoryList.innerHTML = `<div class="empty-state"><i class="fa-regular fa-gem empty-icon"></i><h3 class="headline-md">لا توجد قطع بعد</h3><p class="body-md text-muted">ابدأ بإضافة أول قطعة عبر النموذج.</p></div>`;
    return;
  }
  inventoryList.innerHTML = articles
    .map(
      (a) => `
    <article class="inventory-card" data-id="${a.id}">
      <div class="inventory-card-top">
        <img class="inventory-thumb" src="${escapeHtml(a.image_url || "")}" alt="${escapeHtml(a.title)}" loading="lazy" onerror="this.onerror=null;this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';" />
        <div class="inventory-info">
          <h3 class="inventory-title">${escapeHtml(a.title)}</h3>
          <p class="inventory-desc">${escapeHtml(a.description || "")}</p>
          <p class="inventory-date">${a.created_at ? new Date(a.created_at).toLocaleString("ar-EG") : ""}</p>
        </div>
      </div>
      <div class="inventory-fields">
        <div class="inventory-field">
          <span>السعر</span>
          <input class="admin-input" type="number" step="0.01" min="0" value="${a.price}" data-field="price" />
        </div>
        <div class="inventory-field">
          <span>الكمية المتوفرة</span>
          <input class="admin-input" type="number" step="1" min="0" value="${a.stock}" data-field="stock" />
        </div>
      </div>
      <div class="inventory-actions">
        <button class="btn btn-secondary btn-sm flex-1" data-action="save"><i class="fa-solid fa-check"></i> <span>حفظ التغييرات</span></button>
        <button class="btn btn-danger btn-sm" data-action="delete"><i class="fa-solid fa-trash-can"></i> حذف</button>
      </div>
    </article>`,
    )
    .join("");
}

/* ── Update ── */
async function saveArticle(card) {
  await initSupabaseClient();
  const id = card.dataset.id;
  const price = parseFloat(card.querySelector('[data-field="price"]').value);
  const stock = parseInt(card.querySelector('[data-field="stock"]').value, 10);
  if (isNaN(price) || isNaN(stock)) {
    showToast("أدخل قيماً صحيحة للسعر والكمية", true);
    return;
  }
  const btn = card.querySelector('[data-action="save"]');
  btn.classList.add("loading");
  const { error } = await adminSupabase
    .from(ARTICLES_TABLE)
    .update({ price, stock })
    .eq("id", id);
  btn.classList.remove("loading");
  if (error) {
    showToast("تعذّر الحفظ: " + error.message, true);
    return;
  }
  const a = articles.find((x) => x.id === id);
  if (a) {
    a.price = price;
    a.stock = stock;
  }
  showToast("تم حفظ التغييرات");
}

/* ── Delete ── */
async function deleteArticle(id, card) {
  await initSupabaseClient();
  const ok = confirm(
    "هل أنت متأكد من حذف هذه القطعة؟\nلا يمكن التراجع عن هذه العملية.",
  );
  if (!ok) return;
  const { error } = await adminSupabase
    .from(ARTICLES_TABLE)
    .delete()
    .eq("id", id);
  if (error) {
    showToast("تعذّر الحذف: " + error.message, true);
    return;
  }
  articles = articles.filter((a) => a.id !== id);
  card.style.transition = "opacity .3s ease, transform .3s ease";
  card.style.opacity = "0";
  card.style.transform = "scale(.96)";
  setTimeout(() => {
    card.remove();
    if (articles.length === 0) renderInventory();
  }, 300);
  showToast("تم حذف القطعة");
}

/* Event delegation for update/delete buttons */
inventoryList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const card = btn.closest(".inventory-card");
  const id = card.dataset.id;
  if (btn.dataset.action === "delete") deleteArticle(id, card);
  else if (btn.dataset.action === "save") saveArticle(card);
});

/* ── Image preview ── */
$("article-image").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const nameEl = $("image-filename");
  const preview = $("image-preview");
  if (!file) {
    nameEl.textContent = "";
    preview.classList.add("hidden");
    return;
  }
  nameEl.textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    preview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

document.addEventListener("DOMContentLoaded", () => {
  checkSession();
});
