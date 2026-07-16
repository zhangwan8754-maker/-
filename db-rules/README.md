# 数据库安全规则

云开发要建 3 个集合：`records`（记录）、`comments`（想法/评论）、`profiles`（昵称头像）。

每个集合都要把「权限设置」改成**自定义安全规则**，粘贴对应的 JSON：

- `records` → 用 [`records.json`](records.json)
- `comments` → 用 [`comments.json`](comments.json)
- `profiles` → 用 [`profiles.json`](profiles.json)

三个内容其实一样，含义是：

```json
{
  "read": true,                              // 登录用户都能读（因为是你俩共享的空间）
  "write": "doc._openid == auth.openid"      // 只能改/删自己写的那条
}
```

> ⚠️ `read: true` 意味着"能打开这个小程序的人都能读"。因为你**不发布**小程序、只用「体验版」、只把你俩设为体验成员，所以外人根本打不开，也就读不到。**请不要把小程序提交发布上线**，保持体验版即可，天然私密。
>
> 如果将来你想正式发布，请把 `read` 也改成只允许特定 openid（把你俩的 openid 写进规则），否则任何用户都能读到你们的记录。
