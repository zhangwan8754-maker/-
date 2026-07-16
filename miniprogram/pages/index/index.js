const { RECORD_TYPES, TYPE_MAP, MOODS, AVATAR_CHOICES, relTime, toMillis } = require("../../utils/util.js");

Page({
  data: {
    ready: false,
    errMsg: "",
    needProfile: false,

    myOpenid: "",
    myName: "",
    myEmoji: "🙂",

    types: RECORD_TYPES,
    moods: MOODS,
    avatarChoices: AVATAR_CHOICES,

    filter: "all",
    records: [],

    showCompose: false,
    compose: { editingId: null, type: "happy", mood: 0, content: "" },

    showSettings: false,
    settingsName: "",
    settingsEmoji: "🙂",

    profileSetup: { name: "", emoji: AVATAR_CHOICES[0] },

    drafts: {},
    sending: false,
  },

  recordDocs: [],
  commentDocs: [],
  myProfileId: null,
  _rewatchTimer: null,

  async onLoad() {
    const app = getApp();
    if (!app.globalData.cloudReady) {
      this.setData({ ready: true, errMsg: "云开发没初始化成功。请更新微信到最新版，并确认已开通云开发。" });
      return;
    }
    this.db = wx.cloud.database();
    const openid = await app.getOpenid();
    if (!openid) {
      this.setData({ ready: true, errMsg: "没拿到身份(openid)。请确认：① config.js 里的环境 ID 填对了；② login 云函数已上传并部署。" });
      return;
    }
    this.setData({ myOpenid: openid });
    await this.loadProfile();
    await this.initialFetch();
    this.startWatch();
    this.setData({ ready: true });
  },

  onUnload() { this.closeWatch(); },

  async onPullDownRefresh() {
    await this.initialFetch();
    wx.stopPullDownRefresh();
  },

  // ---------- 个人资料 ----------
  async loadProfile() {
    try {
      const res = await this.db.collection("profiles").where({ _openid: this.data.myOpenid }).get();
      if (res.data && res.data.length) {
        const p = res.data[0];
        this.myProfileId = p._id;
        this.setData({ myName: p.name, myEmoji: p.emoji || "🙂", needProfile: false });
      } else {
        this.setData({ needProfile: true, "profileSetup.emoji": AVATAR_CHOICES[0] });
      }
    } catch (e) {
      // 集合不存在时会报错：提示去创建集合
      this.setData({ needProfile: true, "profileSetup.emoji": AVATAR_CHOICES[0] });
      console.warn("读取 profiles 失败（是否已创建 profiles 集合？）", e);
    }
  },

  onSetupNameInput(e) { this.setData({ "profileSetup.name": e.detail.value }); },
  onSetupPickEmoji(e) { this.setData({ "profileSetup.emoji": e.currentTarget.dataset.emoji }); },
  async saveSetup() {
    const name = (this.data.profileSetup.name || "").trim();
    if (!name) return wx.showToast({ title: "先起个昵称吧", icon: "none" });
    const emoji = this.data.profileSetup.emoji || AVATAR_CHOICES[0];
    try {
      const res = await this.db.collection("profiles").add({ data: { name, emoji, updateTime: this.db.serverDate() } });
      this.myProfileId = res._id;
      this.setData({ myName: name, myEmoji: emoji, needProfile: false });
      wx.showToast({ title: "欢迎 " + name + " 💕", icon: "none" });
    } catch (e) {
      wx.showModal({ title: "保存失败", content: "多半是还没创建 profiles 集合。请按 README 在云开发控制台建好 records / comments / profiles 三个集合。", showCancel: false });
    }
  },

  // ---------- 拉取 + 实时 ----------
  async initialFetch() {
    try {
      const [r, c] = await Promise.all([
        this.db.collection("records").orderBy("createTime", "desc").limit(100).get().catch(() => ({ data: [] })),
        this.db.collection("comments").orderBy("createTime", "asc").limit(300).get().catch(() => ({ data: [] })),
      ]);
      this.recordDocs = r.data || [];
      this.commentDocs = c.data || [];
      this.rebuild();
    } catch (e) {
      console.error(e);
    }
  },

  startWatch() {
    this.closeWatch();
    try {
      this.recordWatcher = this.db.collection("records").watch({
        onChange: (snap) => { if (snap && snap.docs) { this.recordDocs = snap.docs; this.rebuild(); } },
        onError: () => this.rewatchLater(),
      });
      this.commentWatcher = this.db.collection("comments").watch({
        onChange: (snap) => { if (snap && snap.docs) { this.commentDocs = snap.docs; this.rebuild(); } },
        onError: () => this.rewatchLater(),
      });
    } catch (e) { console.error("watch 启动失败", e); }
  },
  closeWatch() {
    try { this.recordWatcher && this.recordWatcher.close(); } catch (e) {}
    try { this.commentWatcher && this.commentWatcher.close(); } catch (e) {}
    this.recordWatcher = this.commentWatcher = null;
  },
  rewatchLater() {
    if (this._rewatchTimer) return;
    this._rewatchTimer = setTimeout(() => {
      this._rewatchTimer = null;
      this.startWatch();
    }, 4000);
  },

  rebuild() {
    const my = this.data.myOpenid;
    const byRec = {};
    (this.commentDocs || []).forEach((c) => { (byRec[c.recordId] = byRec[c.recordId] || []).push(c); });
    Object.keys(byRec).forEach((k) => byRec[k].sort((a, b) => toMillis(a.createTime) - toMillis(b.createTime)));

    let list = (this.recordDocs || []).map((r) => {
      const t = TYPE_MAP[r.type] || { label: r.type, emoji: "📝", color: "#888", soft: "#eeeeee" };
      const comments = (byRec[r._id] || []).map((c) => ({
        _id: c._id, content: c.content, author_name: c.author_name, author_emoji: c.author_emoji || "🙂",
        mine: c._openid === my, timeText: relTime(c.createTime),
      }));
      return {
        _id: r._id,
        type: r.type,
        content: r.content,
        author_name: r.author_name,
        author_emoji: r.author_emoji || "🙂",
        mine: r._openid === my,
        typeInfo: t,
        moodEmoji: r.type === "mood" && r.mood ? MOODS[r.mood - 1] : "",
        timeText: relTime(r.createTime),
        comments,
        commentText: comments.length ? comments.length + " 条想法" : "写想法",
        _ms: toMillis(r.createTime),
      };
    });
    list.sort((a, b) => b._ms - a._ms);
    if (this.data.filter !== "all") list = list.filter((r) => r.type === this.data.filter);
    this.setData({ records: list });
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter }, () => this.rebuild());
  },

  // ---------- 写 / 编辑 记录 ----------
  openCompose() {
    this.setData({ showCompose: true, compose: { editingId: null, type: "happy", mood: 0, content: "" } });
  },
  closeCompose() { this.setData({ showCompose: false }); },
  noop() {},

  pickType(e) {
    const type = e.currentTarget.dataset.type;
    const patch = { "compose.type": type };
    if (type === "mood" && !this.data.compose.mood) patch["compose.mood"] = 4;
    this.setData(patch);
  },
  pickMood(e) { this.setData({ "compose.mood": Number(e.currentTarget.dataset.mood) }); },
  onComposeInput(e) { this.setData({ "compose.content": e.detail.value }); },

  editRecord(e) {
    const id = e.currentTarget.dataset.id;
    const r = (this.recordDocs || []).find((x) => x._id === id);
    if (!r) return;
    this.setData({
      showCompose: true,
      compose: { editingId: id, type: r.type, mood: r.mood || 0, content: r.content },
    });
  },

  async submitCompose() {
    if (this.data.sending) return;
    const c = this.data.compose;
    const content = (c.content || "").trim();
    if (!content) return wx.showToast({ title: "写点什么再保存呀", icon: "none" });
    this.setData({ sending: true });
    const mood = c.type === "mood" ? (c.mood || null) : null;
    try {
      if (c.editingId) {
        await this.db.collection("records").doc(c.editingId).update({
          data: { type: c.type, mood, content, updateTime: this.db.serverDate() },
        });
      } else {
        await this.db.collection("records").add({
          data: {
            author_name: this.data.myName, author_emoji: this.data.myEmoji,
            type: c.type, mood, content, createTime: this.db.serverDate(),
          },
        });
      }
      this.setData({ showCompose: false });
      await this.initialFetch();
      wx.showToast({ title: c.editingId ? "已保存" : "记下来啦", icon: "none" });
    } catch (e) {
      wx.showModal({ title: "保存失败", content: "如果是第一次用，多半是还没创建 records 集合。请按 README 建好集合再试。", showCancel: false });
    } finally {
      this.setData({ sending: false });
    }
  },

  async deleteRecord(e) {
    const id = e.currentTarget.dataset.id;
    const res = await wx.showModal({ title: "删除这条记录？", content: "下面的想法也会一起删掉。", confirmColor: "#d9556f" });
    if (!res.confirm) return;
    try {
      const r = await wx.cloud.callFunction({ name: "deleteRecord", data: { recordId: id } });
      if (r.result && r.result.ok) { await this.initialFetch(); }
      else wx.showToast({ title: (r.result && r.result.msg) || "删除失败", icon: "none" });
    } catch (err) {
      wx.showToast({ title: "删除失败（deleteRecord 云函数是否已部署？）", icon: "none" });
    }
  },

  // ---------- 想法 / 评论 ----------
  onDraftInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ ["drafts." + id]: e.detail.value });
  },
  async sendComment(e) {
    const id = e.currentTarget.dataset.id;
    const text = ((this.data.drafts[id] || "")).trim();
    if (!text) return;
    try {
      await this.db.collection("comments").add({
        data: {
          recordId: id, author_name: this.data.myName, author_emoji: this.data.myEmoji,
          content: text, createTime: this.db.serverDate(),
        },
      });
      this.setData({ ["drafts." + id]: "" });
      await this.initialFetch();
    } catch (err) {
      wx.showModal({ title: "发送失败", content: "如果是第一次用，多半是还没创建 comments 集合。请按 README 建好集合再试。", showCancel: false });
    }
  },
  async deleteComment(e) {
    const cid = e.currentTarget.dataset.id;
    const res = await wx.showModal({ title: "删除这条想法？", content: "", confirmColor: "#d9556f" });
    if (!res.confirm) return;
    try {
      await this.db.collection("comments").doc(cid).remove();
      await this.initialFetch();
    } catch (err) {
      wx.showToast({ title: "删除失败", icon: "none" });
    }
  },

  // ---------- 设置 ----------
  openSettings() {
    this.setData({ showSettings: true, settingsName: this.data.myName, settingsEmoji: this.data.myEmoji });
  },
  closeSettings() { this.setData({ showSettings: false }); },
  onSettingsNameInput(e) { this.setData({ settingsName: e.detail.value }); },
  onSettingsPickEmoji(e) { this.setData({ settingsEmoji: e.currentTarget.dataset.emoji }); },
  async saveSettings() {
    const name = (this.data.settingsName || "").trim();
    if (!name) return wx.showToast({ title: "昵称不能为空", icon: "none" });
    const emoji = this.data.settingsEmoji || "🙂";
    try {
      if (this.myProfileId) {
        await this.db.collection("profiles").doc(this.myProfileId).update({ data: { name, emoji, updateTime: this.db.serverDate() } });
      } else {
        const res = await this.db.collection("profiles").add({ data: { name, emoji, updateTime: this.db.serverDate() } });
        this.myProfileId = res._id;
      }
      this.setData({ myName: name, myEmoji: emoji, showSettings: false });
      wx.showToast({ title: "已保存", icon: "none" });
    } catch (e) {
      wx.showToast({ title: "保存失败", icon: "none" });
    }
  },
});
