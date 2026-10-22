# Cellapp 笔记 Demo

这是一个可以直接发布的静态前端。Cellapp 管理登录身份、应用数据库和访问控制；浏览器用 `@cellapp/sdk` 读写 `notes` 表。每位已获准访问应用的用户只能看到自己的笔记。无需自建服务端、Supabase 项目或数据库密码。

## 运行

需要 Node.js 22.12+、已安装并登录的 `cellapp` CLI，以及一个可用的 Cellapp 环境。先设置 `CELLAPP_ORIGIN` 为控制台 HTTPS 地址。

```sh
cd <本示例目录>
npm ci
npm run build
cellapp deploy --project . --output dist --name "Notes demo" --slug notes-demo
cellapp data plan --project .
cellapp data apply --project .
cellapp data verify --project .
```

首次部署可加 `--namespace <你的空间名>` 自选命名空间；未指定时 Cellapp 生成与平台用户 ID 无关的空间名。示例中的 `--slug notes-demo` 在同一空间内必须唯一。应用显示名可以重名，控制台提供 `@空间名/notes-demo` 分享链接，原应用 ID 地址保持稳定。首次部署会创建应用及项目关联，然后 `data apply` 在独立应用数据库中建表并授予当前应用的表操作权限。首次发布返回的访问密钥只交给所有者，不要存入项目文件。打开部署返回的应用地址，完成 Cellapp 登录；受限应用还需授权访问。页面可新增、查看、编辑、删除笔记；“Run CRUD” 会依次执行创建、读取、更新和删除，并显示结果。第一次打开前应完成 `data verify`，确认 `ready: true`。

`cellapp.data.json` 声明表、主键、索引及 `own-rows` 策略。[`notes.ts`](notes.ts) 使用官方 SDK 获取应用内身份并执行受支持的表操作。此仓库示例通过本地 `file:` 依赖使用同仓库的 SDK 包；独立应用安装已发布的 `@cellapp/sdk`。部署 CLI 将选定的 `major.minor` 契约号写入输出 HTML，SDK 请求自动携带该版本；参阅[版本说明](https://cellapp.ai/deploy/api-versions.zh-CN.md)和[changelog](https://cellapp.ai/deploy/api-changelog.md)。构建产物不包含 CLI 凭证、访问密钥或数据库连接串。
