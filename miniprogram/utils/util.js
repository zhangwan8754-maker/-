// 记录类型（可自定义：加/改这里即可，不用动数据库）
const RECORD_TYPES = [
  { key: "thanks", label: "感谢", emoji: "💛", color: "#c8890b", soft: "#fff4d6" },
  { key: "happy",  label: "甜蜜", emoji: "💗", color: "#d9556f", soft: "#fde8ec" },
  { key: "care",   label: "在意", emoji: "🌧️", color: "#4a7fe0", soft: "#e6efff" },
  { key: "wish",   label: "希望", emoji: "⭐", color: "#9a5fd0", soft: "#f2e6ff" },
  { key: "daily",  label: "日常", emoji: "📖", color: "#3f9960", soft: "#e2f6e9" },
  { key: "mood",   label: "心情", emoji: "😊", color: "#e07a2f", soft: "#ffeede" },
];

const TYPE_MAP = {};
RECORD_TYPES.forEach((t) => (TYPE_MAP[t.key] = t));

const MOODS = ["😢", "😕", "😐", "🙂", "😄"]; // 分数 1..5

const AVATAR_CHOICES = ["🙂","😄","😍","🥰","😎","🐰","🐱","🐻","🐼","🦊","🌸","⭐","🍓","🌙","🍑","🧸"];

// 时间戳（可能是 Date、数字、或 {$date} 之类）→ 毫秒
function toMillis(t) {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function pad(n) { return n < 10 ? "0" + n : "" + n; }

// 相对时间：刚刚 / x分钟前 / x小时前 / 昨天 HH:mm / M月D日 HH:mm / YYYY/M/D
function relTime(t) {
  const ms = toMillis(t);
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const diff = (now.getTime() - ms) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (diff < 86400 && d.getDate() === now.getDate()) return Math.floor(diff / 3600) + " 小时前";
  const y = new Date(now.getTime() - 86400000);
  if (d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear())
    return "昨天 " + hm;
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}

module.exports = { RECORD_TYPES, TYPE_MAP, MOODS, AVATAR_CHOICES, relTime, toMillis };
