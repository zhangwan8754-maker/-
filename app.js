/* ============================================================
   我们的记录 · 应用逻辑
   - 填了 config.js 里的 Supabase → 云端实时同步（两部手机互通）
   - 没填 → 本地体验模式（只存在本机，方便先试界面）
   ============================================================ */

/* ---------- 可自定义：记录类型 & 心情 ----------
   想加/改类型，直接改这个数组即可（key 不要和已有记录冲突）。*/
const RECORD_TYPES = [
  { key: "thanks", label: "感谢", emoji: "💛", color: "#e0a500" },
  { key: "happy",  label: "甜蜜", emoji: "💗", color: "#e8738a" },
  { key: "care",   label: "在意", emoji: "🌧️", color: "#5b8def" },
  { key: "wish",   label: "希望", emoji: "⭐", color: "#b06fe0" },
  { key: "daily",  label: "日常", emoji: "📖", color: "#5aa96f" },
  { key: "mood",   label: "心情", emoji: "😊", color: "#f0883e" },
];
const TYPE_MAP = Object.fromEntries(RECORD_TYPES.map((t) => [t.key, t]));
const MOODS = ["😢", "😕", "😐", "🙂", "😄"]; // 分数 1..5
const AVATAR_CHOICES = ["🙂","😄","😍","🥰","😎","🐰","🐱","🐻","🐼","🦊","🌸","⭐","🍓","🌙","🍑","🧸"];

/* ---------- 运行模式检测 ---------- */
const CFG = window.APP_CONFIG || {};
const CLOUD =
  !!CFG.SUPABASE_URL &&
  !!CFG.SUPABASE_ANON_KEY &&
  !/YOUR[-_]/.test(CFG.SUPABASE_URL) &&
  !/YOUR[-_]/.test(CFG.SUPABASE_ANON_KEY);

let sb = null;
if (CLOUD) {
  if (!window.supabase) {
    console.error("Supabase 客户端脚本未加载（可能是网络问题）。");
  } else {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }
}

/* ---------- 全局状态 ---------- */
const state = {
  user: null,          // 云端: supabase user；本地: {id,name,emoji}
  myProfile: null,     // { display_name, avatar_emoji }
  profiles: {},        // userId -> { display_name, avatar_emoji }
  records: [],         // 每条含 .comments 数组
  filter: "all",
  compose: null,       // { editingId, type, mood, content } | null
  settingsOpen: false,
  authMode: "signin",  // signin | signup
  authError: "",
  drafts: {},          // recordId -> 评论草稿
  focusDraft: null,    // 渲染后要重新聚焦的评论输入框 recordId
  loading: true,
};

/* ============================================================
   数据层：云端 / 本地 两套实现，接口一致
   ============================================================ */
const LS = {
  user: "ourlog.local.user",
  records: "ourlog.local.records",
  comments: "ourlog.local.comments",
};
const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const cloudApi = {
  async getSession() { const { data } = await sb.auth.getSession(); return data.session; },
  async signUp(email, password, displayName) {
    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    return data.session; // 若开启了邮箱确认，session 为 null
  },
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signOut() { await sb.auth.signOut(); },
  async loadProfiles() {
    const { data, error } = await sb.from("profiles").select("*");
    if (error) throw error;
    const map = {};
    (data || []).forEach((p) => (map[p.id] = { display_name: p.display_name, avatar_emoji: p.avatar_emoji || "🙂" }));
    return map;
  },
  async saveProfile({ display_name, avatar_emoji }) {
    const { error } = await sb.from("profiles").upsert({
      id: state.user.id, display_name, avatar_emoji, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  async fetchRecords() {
    const [{ data: recs, error: e1 }, { data: cmts, error: e2 }] = await Promise.all([
      sb.from("records").select("*").order("created_at", { ascending: false }),
      sb.from("comments").select("*").order("created_at", { ascending: true }),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const byRec = {};
    (cmts || []).forEach((c) => (byRec[c.record_id] ||= []).push(c));
    return (recs || []).map((r) => ({ ...r, comments: byRec[r.id] || [] }));
  },
  async addRecord({ type, mood, content }) {
    const { error } = await sb.from("records").insert({
      user_id: state.user.id, author_name: myName(), type, mood: mood ?? null, content,
    });
    if (error) throw error;
  },
  async updateRecord(id, patch) {
    const { error } = await sb.from("records").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deleteRecord(id) {
    const { error } = await sb.from("records").delete().eq("id", id);
    if (error) throw error;
  },
  async addComment(recordId, content) {
    const { error } = await sb.from("comments").insert({
      record_id: recordId, user_id: state.user.id, author_name: myName(), content,
    });
    if (error) throw error;
  },
  async deleteComment(id) {
    const { error } = await sb.from("comments").delete().eq("id", id);
    if (error) throw error;
  },
};

const localApi = {
  getLocalUser() { return readLS(LS.user, null); },
  async signUpLocal(name, emoji) {
    const u = { id: "local-" + Math.random().toString(36).slice(2, 9), name, emoji };
    writeLS(LS.user, u);
    return u;
  },
  async signOut() { localStorage.removeItem(LS.user); },
  async loadProfiles() {
    const u = this.getLocalUser();
    return u ? { [u.id]: { display_name: u.name, avatar_emoji: u.emoji || "🙂" } } : {};
  },
  async saveProfile({ display_name, avatar_emoji }) {
    const u = this.getLocalUser();
    writeLS(LS.user, { ...u, name: display_name, emoji: avatar_emoji });
    state.user = { ...state.user, name: display_name, emoji: avatar_emoji };
  },
  async fetchRecords() {
    const recs = readLS(LS.records, []);
    const cmts = readLS(LS.comments, []);
    const byRec = {};
    cmts.forEach((c) => (byRec[c.record_id] ||= []).push(c));
    return recs
      .map((r) => ({ ...r, comments: (byRec[r.id] || []).sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async addRecord({ type, mood, content }) {
    const recs = readLS(LS.records, []);
    recs.push({
      id: crypto.randomUUID(), user_id: state.user.id, author_name: myName(),
      type, mood: mood ?? null, content,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    writeLS(LS.records, recs);
  },
  async updateRecord(id, patch) {
    const recs = readLS(LS.records, []);
    const i = recs.findIndex((r) => r.id === id);
    if (i >= 0) { recs[i] = { ...recs[i], ...patch, updated_at: new Date().toISOString() }; writeLS(LS.records, recs); }
  },
  async deleteRecord(id) {
    writeLS(LS.records, readLS(LS.records, []).filter((r) => r.id !== id));
    writeLS(LS.comments, readLS(LS.comments, []).filter((c) => c.record_id !== id));
  },
  async addComment(recordId, content) {
    const cmts = readLS(LS.comments, []);
    cmts.push({
      id: crypto.randomUUID(), record_id: recordId, user_id: state.user.id,
      author_name: myName(), content, created_at: new Date().toISOString(),
    });
    writeLS(LS.comments, cmts);
  },
  async deleteComment(id) {
    writeLS(LS.comments, readLS(LS.comments, []).filter((c) => c.id !== id));
  },
};

/* ---------- 小工具 ---------- */
function myName() {
  return (state.myProfile && state.myProfile.display_name) || state.user?.name || state.user?.email || "我";
}
function myEmoji() {
  return (state.myProfile && state.myProfile.avatar_emoji) || state.user?.emoji || "🙂";
}
function avatarOf(userId) { return state.profiles[userId]?.avatar_emoji || "🙂"; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function relTime(iso) {
  const d = new Date(iso), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400 && d.getDate() === now.getDate()) return Math.floor(diff / 3600) + " 小时前";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear())
    return "昨天 " + hm(d);
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

/* ============================================================
   加载数据 + 实时订阅
   ============================================================ */
let realtimeChannel = null;
let refetchTimer = null;

async function loadAll() {
  const api = CLOUD ? cloudApi : localApi;
  state.profiles = await api.loadProfiles();
  state.records = await api.fetchRecords();
  if (state.user) {
    state.myProfile = state.profiles[state.user.id] || {
      display_name: state.user.name || (state.user.email ? state.user.email.split("@")[0] : "我"),
      avatar_emoji: state.user.emoji || "🙂",
    };
  }
}

function startRealtime() {
  if (!CLOUD || realtimeChannel) return;
  realtimeChannel = sb
    .channel("ourlog-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "records" }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleRefetch)
    .subscribe();
}
function stopRealtime() {
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}
function scheduleRefetch() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(async () => {
    try { captureLiveInputs(); await loadAll(); render(); } catch (e) { console.error(e); }
  }, 180);
}

/* 渲染前，把正在输入的内容存进 state，避免刷新时丢失 */
function captureLiveInputs() {
  document.querySelectorAll("[data-draft]").forEach((el) => {
    const id = el.getAttribute("data-draft");
    if (el.value) state.drafts[id] = el.value; else delete state.drafts[id];
  });
  const ta = document.getElementById("compose-text");
  if (ta && state.compose) state.compose.content = ta.value;
  const nameInput = document.getElementById("settings-name");
  if (nameInput && state.settingsOpen) state._settingsName = nameInput.value;
}

/* ============================================================
   渲染
   ============================================================ */
const $app = document.getElementById("app");

function render() {
  captureLiveInputs(); // 每次重渲染前，先把正在输入的内容存进 state，避免丢失
  if (state.loading) { $app.innerHTML = `<div class="boot">正在加载…</div>`; return; }
  if (!state.user) { $app.innerHTML = renderAuth(); afterRender(); return; }
  $app.innerHTML = renderMain();
  afterRender();
}

function afterRender() {
  // 恢复评论输入框焦点
  if (state.focusDraft) {
    const el = document.querySelector(`[data-draft="${state.focusDraft}"]`);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    state.focusDraft = null;
  }
}

/* ---------- 登录 / 注册 ---------- */
function renderAuth() {
  if (!CLOUD) return renderLocalAuth();
  const isSignup = state.authMode === "signup";
  return `
  <div class="auth">
    <div class="logo"><div class="heart">💞</div></div>
    <h1>我们的记录</h1>
    <div class="tag">两个人的反馈日记 · 互相看见，彼此回应</div>
    ${state.authError ? `<div class="err">${esc(state.authError)}</div>` : ""}
    <form id="auth-form">
      ${isSignup ? `
      <div class="field">
        <label>昵称（对方会看到）</label>
        <input id="auth-name" placeholder="比如：小明 / 宝宝" autocomplete="nickname" />
      </div>` : ""}
      <div class="field">
        <label>邮箱</label>
        <input id="auth-email" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="field">
        <label>密码${isSignup ? "（至少 6 位）" : ""}</label>
        <input id="auth-pass" type="password" placeholder="••••••" autocomplete="${isSignup ? "new-password" : "current-password"}" />
      </div>
      <button type="submit" class="btn-primary" id="auth-submit">${isSignup ? "注册并进入" : "登录"}</button>
    </form>
    <div class="switch">
      ${isSignup ? "已经有账号了？" : "还没有账号？"}
      <span class="btn-text" data-action="auth-switch">${isSignup ? "去登录" : "去注册"}</span>
    </div>
    <div class="note">💡 你和对方各注册一个账号（同一个 Supabase 项目），就能互相看到记录。都注册完后，建议在 Supabase 后台关闭"允许新用户注册"。</div>
  </div>`;
}

function renderLocalAuth() {
  return `
  <div class="auth">
    <div class="logo"><div class="heart">💞</div></div>
    <h1>我们的记录</h1>
    <div class="tag">本地体验模式 · 先感受一下界面</div>
    <form id="local-auth-form">
      <div class="field">
        <label>你的昵称</label>
        <input id="local-name" placeholder="比如：小明" />
      </div>
      <div class="field">
        <label>选个头像</label>
        <div class="type-grid" id="emoji-grid">
          ${AVATAR_CHOICES.slice(0, 8).map((e, i) =>
            `<button type="button" class="type-opt ${i === 0 ? "active" : ""}" data-action="pick-emoji" data-emoji="${e}"><span class="emo">${e}</span></button>`
          ).join("")}
        </div>
      </div>
      <button type="submit" class="btn-primary">进入</button>
    </form>
    <div class="note">当前未连接云端，数据只存在这台手机。想和对方实时互通，按 README 填好 config.js 里的 Supabase 即可（届时会自动切换到登录模式）。</div>
  </div>`;
}

/* ---------- 主界面 ---------- */
function renderMain() {
  const modeSub = CLOUD ? "☁️ 已连接 · 实时同步" : "📱 本地体验模式";
  const list = state.filter === "all"
    ? state.records
    : state.records.filter((r) => r.type === state.filter);

  return `
  <div class="app-shell">
    <div class="topbar">
      <div class="avatar">${myEmoji()}</div>
      <div>
        <h1>我们的记录</h1>
        <div class="sub">${modeSub}</div>
      </div>
      <div class="spacer"></div>
      <button class="icon-btn" data-action="open-settings" title="设置">⚙️</button>
    </div>

    ${!CLOUD ? `<div class="banner">📱 <div>本地体验模式：数据只存在这台手机，还没和对方互通。填好 Supabase 配置即可开启实时同步。</div></div>` : ""}

    <div class="filters">
      <button class="chip ${state.filter === "all" ? "active" : ""}" data-action="filter" data-filter="all">全部</button>
      ${RECORD_TYPES.map((t) =>
        `<button class="chip ${state.filter === t.key ? "active" : ""}" data-action="filter" data-filter="${t.key}">${t.emoji} ${t.label}</button>`
      ).join("")}
    </div>

    <div class="feed">
      ${list.length === 0 ? renderEmpty() : list.map(renderCard).join("")}
    </div>

    <button class="fab" data-action="open-compose" aria-label="写一条">＋</button>
    ${state.compose ? renderCompose() : ""}
    ${state.settingsOpen ? renderSettings() : ""}
  </div>`;
}

function renderEmpty() {
  return `<div class="empty"><div class="big">🌱</div>
    还没有记录。<br/>点右下角的 ＋ 写下第一条吧，<br/>可以是感谢、甜蜜、在意的事，或今天的心情。</div>`;
}

function renderCard(r) {
  const t = TYPE_MAP[r.type] || { label: r.type, emoji: "📝", color: "#888" };
  const mine = r.user_id === state.user.id;
  const tint = `color:${t.color};background:color-mix(in srgb, ${t.color} 15%, transparent)`;
  return `
  <div class="card" data-record="${r.id}">
    <div class="card-head">
      <div class="mini-avatar">${avatarOf(r.user_id)}</div>
      <div>
        <div class="name">${esc(r.author_name)}${mine ? " · 我" : ""}</div>
        <div class="time">${relTime(r.created_at)}</div>
      </div>
      <div class="spacer"></div>
      <span class="type-badge" style="${tint}">${t.emoji} ${t.label}</span>
    </div>
    <div class="card-body">
      <div class="content">${esc(r.content)}</div>
      ${r.type === "mood" && r.mood ? `<div class="mood-row">${MOODS[r.mood - 1] || ""}</div>` : ""}
    </div>
    <div class="card-actions">
      <button data-action="focus-comment" data-id="${r.id}">💬 ${r.comments.length > 0 ? r.comments.length + " 条想法" : "写想法"}</button>
      ${mine ? `<button data-action="edit-record" data-id="${r.id}">✏️ 编辑</button>` : ""}
      ${mine ? `<button data-action="delete-record" data-id="${r.id}">🗑 删除</button>` : ""}
    </div>
    <div class="comments">
      ${r.comments.map(renderComment).join("")}
      <div class="comment-box">
        <input data-draft="${r.id}" placeholder="发表你的想法…" value="${esc(state.drafts[r.id] || "")}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();window.__sendComment('${r.id}')}" />
        <button class="send" data-action="send-comment" data-id="${r.id}">➤</button>
      </div>
    </div>
  </div>`;
}

function renderComment(c) {
  const mine = c.user_id === state.user.id;
  return `
  <div class="comment">
    <div class="c-avatar">${avatarOf(c.user_id)}</div>
    <div class="c-body">
      <div class="c-name">${esc(c.author_name)}<span class="c-time">${relTime(c.created_at)}</span></div>
      <div class="c-text">${esc(c.content)}</div>
    </div>
    ${mine ? `<button class="c-del" data-action="delete-comment" data-id="${c.id}">删除</button>` : ""}
  </div>`;
}

/* ---------- 写记录 抽屉 ---------- */
function renderCompose() {
  const c = state.compose;
  const editing = !!c.editingId;
  return `
  <div class="sheet-mask" data-action="close-sheet">
    <div class="sheet">
      <div class="grip"></div>
      <h2>${editing ? "编辑记录" : "写一条记录"}</h2>
      <div class="field">
        <label>类型</label>
        <div class="type-grid">
          ${RECORD_TYPES.map((t) =>
            `<button class="type-opt ${c.type === t.key ? "active" : ""}" data-action="pick-type" data-type="${t.key}">
               <span class="emo">${t.emoji}</span>${t.label}</button>`
          ).join("")}
        </div>
      </div>
      ${c.type === "mood" ? `
      <div class="field">
        <label>今天的心情</label>
        <div class="mood-picker">
          ${MOODS.map((m, i) =>
            `<button class="mood-opt ${c.mood === i + 1 ? "active" : ""}" data-action="pick-mood" data-mood="${i + 1}">${m}</button>`
          ).join("")}
        </div>
      </div>` : ""}
      <div class="field">
        <label>${c.type === "wish" ? "你希望的是…" : c.type === "care" ? "让你在意/在乎的是…" : "想说的话"}</label>
        <textarea id="compose-text" placeholder="写下来，对方会看到，也可以在下面回应你 💬">${esc(c.content || "")}</textarea>
      </div>
      <button class="btn-primary" data-action="submit-record">${editing ? "保存修改" : "记下来"}</button>
      <button class="btn-ghost" data-action="close-sheet">取消</button>
    </div>
  </div>`;
}

/* ---------- 设置 抽屉 ---------- */
function renderSettings() {
  const name = state._settingsName ?? myName();
  const cur = state._pickedEmoji || myEmoji();
  return `
  <div class="sheet-mask" data-action="close-sheet">
    <div class="sheet">
      <div class="grip"></div>
      <h2>设置</h2>
      <div class="field">
        <label>昵称</label>
        <input id="settings-name" value="${esc(name)}" />
      </div>
      <div class="field">
        <label>头像</label>
        <div class="type-grid">
          ${AVATAR_CHOICES.map((e) =>
            `<button class="type-opt ${e === cur ? "active" : ""}" data-action="pick-emoji" data-emoji="${e}"><span class="emo">${e}</span></button>`
          ).join("")}
        </div>
      </div>
      <button class="btn-primary" data-action="save-settings">保存</button>
      <button class="btn-ghost" data-action="logout">退出登录</button>
      <div class="note" style="margin-top:12px;color:var(--text-dim);font-size:12px">
        ${CLOUD ? "☁️ 云端模式：改了昵称/头像后，新记录会用新的显示。" : "📱 本地模式：数据仅存本机。"}
      </div>
    </div>
  </div>`;
}

/* ============================================================
   交互事件（事件委托）
   ============================================================ */
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.getAttribute("data-action");
  const id = el.getAttribute("data-id");

  switch (action) {
    case "auth-switch":
      state.authMode = state.authMode === "signup" ? "signin" : "signup";
      state.authError = ""; render(); break;

    case "pick-emoji":
      state._pickedEmoji = el.getAttribute("data-emoji");
      // 高亮
      el.parentElement.querySelectorAll(".type-opt").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      break;

    case "filter":
      state.filter = el.getAttribute("data-filter"); render(); break;

    case "open-compose":
      state.compose = { editingId: null, type: "happy", mood: null, content: "" }; render(); break;

    case "close-sheet":
      // 点在抽屉内部空白处不关闭；只有点遮罩背景或"取消"按钮才关闭
      if (el.classList.contains("sheet-mask") && e.target !== el) break;
      captureLiveInputs();
      state.compose = null; state.settingsOpen = false; state._settingsName = null; render(); break;

    case "pick-type": {
      captureLiveInputs();
      state.compose.type = el.getAttribute("data-type");
      if (state.compose.type === "mood" && !state.compose.mood) state.compose.mood = 4;
      render(); break;
    }
    case "pick-mood":
      captureLiveInputs();
      state.compose.mood = parseInt(el.getAttribute("data-mood"), 10); render(); break;

    case "submit-record": await submitRecord(); break;

    case "focus-comment":
      state.focusDraft = id; render(); break;

    case "send-comment": await sendComment(id); break;

    case "delete-comment":
      await (CLOUD ? cloudApi : localApi).deleteComment(id);
      await loadAll(); render(); break;

    case "edit-record": {
      const r = state.records.find((x) => x.id === id);
      if (r) { state.compose = { editingId: r.id, type: r.type, mood: r.mood, content: r.content }; render(); }
      break;
    }
    case "delete-record":
      if (confirm("确定删除这条记录吗？下面的想法也会一起删掉。")) {
        await (CLOUD ? cloudApi : localApi).deleteRecord(id);
        await loadAll(); render();
      }
      break;

    case "open-settings":
      state.settingsOpen = true; state._settingsName = myName(); state._pickedEmoji = myEmoji(); render(); break;

    case "save-settings": await saveSettings(); break;

    case "logout": await doLogout(); break;
  }
});

/* 表单提交（登录/注册/本地进入） */
document.addEventListener("submit", async (e) => {
  if (e.target.id === "auth-form") { e.preventDefault(); await doAuth(); }
  if (e.target.id === "local-auth-form") { e.preventDefault(); await doLocalEnter(); }
});

window.__sendComment = (id) => sendComment(id);

/* ---------- 具体动作 ---------- */
async function doAuth() {
  const email = document.getElementById("auth-email").value.trim();
  const pass = document.getElementById("auth-pass").value;
  const name = state.authMode === "signup" ? (document.getElementById("auth-name").value.trim()) : "";
  state.authError = "";
  if (!email || !pass) { state.authError = "请填写邮箱和密码"; return render(); }
  if (state.authMode === "signup" && !name) { state.authError = "请填个昵称，方便对方认出你"; return render(); }

  const btn = document.getElementById("auth-submit");
  if (btn) { btn.disabled = true; btn.textContent = "请稍候…"; }
  try {
    if (state.authMode === "signup") {
      const session = await cloudApi.signUp(email, pass, name);
      if (!session) {
        state.authMode = "signin";
        state.authError = "注册成功！如果收到确认邮件，请先点邮件里的链接，再回来登录。";
        return render();
      }
    } else {
      await cloudApi.signIn(email, pass);
    }
    // onAuthStateChange 会接手后续加载
  } catch (err) {
    state.authError = translateAuthError(err.message || String(err));
    render();
  }
}

async function doLocalEnter() {
  const name = document.getElementById("local-name").value.trim();
  if (!name) { toast("先填个昵称吧"); return; }
  const emoji = state._pickedEmoji || AVATAR_CHOICES[0];
  state.user = await localApi.signUpLocal(name, emoji);
  await loadAll();
  render();
}

async function submitRecord() {
  const c = state.compose;
  const content = (document.getElementById("compose-text")?.value || "").trim();
  if (!content) { toast("写点什么再保存呀"); return; }
  const api = CLOUD ? cloudApi : localApi;
  try {
    if (c.editingId) {
      await api.updateRecord(c.editingId, { type: c.type, mood: c.type === "mood" ? c.mood : null, content });
    } else {
      await api.addRecord({ type: c.type, mood: c.type === "mood" ? c.mood : null, content });
    }
    state.compose = null;
    await loadAll(); // 立即刷新，自己马上看到（云端下 realtime 再把对方的变化推过来）
    render();
    toast(c.editingId ? "已保存 ✓" : "记下来啦 ✓");
  } catch (err) {
    toast("保存失败：" + (err.message || err));
  }
}

async function sendComment(recordId) {
  const input = document.querySelector(`[data-draft="${recordId}"]`);
  const content = (input?.value || state.drafts[recordId] || "").trim();
  if (!content) return;
  delete state.drafts[recordId];
  if (input) input.value = "";
  const api = CLOUD ? cloudApi : localApi;
  try {
    await api.addComment(recordId, content);
    await loadAll(); render();
  } catch (err) {
    state.drafts[recordId] = content;
    toast("发送失败：" + (err.message || err));
    render();
  }
}

async function saveSettings() {
  const name = (document.getElementById("settings-name")?.value || "").trim();
  if (!name) { toast("昵称不能为空"); return; }
  const emoji = state._pickedEmoji || myEmoji();
  const api = CLOUD ? cloudApi : localApi;
  try {
    await api.saveProfile({ display_name: name, avatar_emoji: emoji });
    state.myProfile = { display_name: name, avatar_emoji: emoji };
    state.profiles[state.user.id] = state.myProfile;
    state.settingsOpen = false; state._settingsName = null;
    await loadAll();
    render();
    toast("已保存 ✓");
  } catch (err) {
    toast("保存失败：" + (err.message || err));
  }
}

async function doLogout() {
  stopRealtime();
  if (CLOUD) await cloudApi.signOut(); else await localApi.signOut();
  state.user = null; state.myProfile = null; state.records = []; state.settingsOpen = false;
  render();
}

function translateAuthError(msg) {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "邮箱或密码不对";
  if (m.includes("already registered") || m.includes("already exists")) return "这个邮箱已经注册过了，直接去登录吧";
  if (m.includes("password should be at least")) return "密码太短了（至少 6 位）";
  if (m.includes("email not confirmed")) return "邮箱还没确认，请去邮箱点确认链接（或让对方在后台关闭邮箱确认）";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "邮箱格式不对";
  if (m.includes("rate limit")) return "操作太频繁，稍等一下再试";
  return msg;
}

/* ============================================================
   启动
   ============================================================ */
async function boot() {
  try {
    if (CLOUD) {
      if (!sb) { state.loading = false; $app.innerHTML = `<div class="boot">网络问题：Supabase 客户端没加载成功，请检查网络后刷新。</div>`; return; }
      const session = await cloudApi.getSession();
      state.user = session?.user || null;
      sb.auth.onAuthStateChange(async (_evt, s) => {
        const wasLogged = !!state.user;
        state.user = s?.user || null;
        if (state.user && !wasLogged) {
          state.loading = true; render();
          await loadAll(); startRealtime(); state.loading = false; render();
        } else if (!state.user) {
          stopRealtime(); render();
        }
      });
      if (state.user) { await loadAll(); startRealtime(); }
    } else {
      state.user = localApi.getLocalUser();
      if (state.user) await loadAll();
    }
  } catch (err) {
    console.error(err);
    toast("加载出错：" + (err.message || err));
  } finally {
    state.loading = false;
    render();
  }

  // 注册 Service Worker（PWA / 添加到主屏）
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
