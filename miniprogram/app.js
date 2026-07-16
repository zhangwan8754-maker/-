// 全局逻辑：初始化云开发 + 取到自己的 openid（缓存起来给各页面用）
const config = require("./config.js");

App({
  globalData: {
    openid: "",
    cloudReady: false,
    envId: config.ENV_ID,
  },
  _openidResolvers: [],

  onLaunch() {
    if (!wx.cloud) {
      console.error("当前基础库过低，请把微信更新到最新版本再用。");
      this._flush();
      return;
    }
    const envValid = config.ENV_ID && !/REPLACE_WITH/.test(config.ENV_ID);
    wx.cloud.init({
      env: envValid ? config.ENV_ID : undefined,
      traceUser: true,
    });
    this.globalData.cloudReady = true;

    // 通过云函数拿到自己的 openid
    wx.cloud
      .callFunction({ name: "login", data: {} })
      .then((res) => {
        this.globalData.openid = (res.result && res.result.openid) || "";
        this._flush();
      })
      .catch((err) => {
        console.error("调用 login 云函数失败（是否已上传并部署？）", err);
        this._flush();
      });
  },

  _flush() {
    this._openidResolvers.forEach((r) => r(this.globalData.openid));
    this._openidResolvers = [];
  },

  // 页面用：await getApp().getOpenid()
  getOpenid() {
    return new Promise((resolve) => {
      if (this.globalData.openid) resolve(this.globalData.openid);
      else this._openidResolvers.push(resolve);
    });
  },
});
