// 云函数 login：返回当前用户的 openid（用来识别"是不是我"、找我的资料）
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();
  return { openid: OPENID, appid: APPID, unionid: UNIONID };
};
