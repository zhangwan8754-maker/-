// ============================================================
//  配置模板：把下面两项换成你自己 Supabase 项目里的值，
//  然后把本文件复制/改名为 config.js
//
//  在哪里找这两个值：
//  Supabase 控制台 → 你的项目 → Settings → API
//    · Project URL        → 填到 SUPABASE_URL
//    · Project API keys 里的 "anon public" → 填到 SUPABASE_ANON_KEY
//
//  注意：anon key 是"公开可暴露"的，放在网页里是安全的
//  （真正的保护靠数据库里的 RLS 规则，schema.sql 已经配好）。
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_PUBLIC_KEY",
};
