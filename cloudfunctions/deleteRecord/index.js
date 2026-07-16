// 云函数 deleteRecord：删除一条记录，并连带删掉它下面所有想法（包括对方写的）。
// 用云函数是因为：客户端权限只能删自己的数据，删不掉对方在这条记录下的评论；
// 云函数以管理员身份运行，可以级联删除。这里会先校验"确实是本人的记录"。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { recordId } = event;
  if (!recordId) return { ok: false, msg: "缺少 recordId" };

  // 校验归属
  const rec = await db.collection("records").doc(recordId).get().catch(() => null);
  if (!rec || !rec.data) return { ok: false, msg: "记录不存在" };
  if (rec.data._openid !== OPENID) return { ok: false, msg: "只能删除自己的记录" };

  await db.collection("records").doc(recordId).remove();
  // 级联删除该记录下的所有想法
  await db.collection("comments").where({ recordId }).remove();
  return { ok: true };
};
