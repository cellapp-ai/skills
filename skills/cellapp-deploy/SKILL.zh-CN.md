---
name: cellapp-deploy
description: 从用户项目开发、更新并部署静态 Cellapp 应用。按需运行已发布客户端，引导浏览器授权，并可管理受支持的应用数据表。
---

# 开发并部署 Cellapp 应用

[English version](SKILL.md)

部署和数据表操作使用官方 `cellapp` 客户端。新版客户端通过 `/auth/device` 请求浏览器批准，并使用 `/api/control/v1/*` 管理资源；旧版客户端的根路径在迁移期继续可用。请运行 CLI 命令，不自行拼接 HTTP 请求。Agent 自行获取并运行客户端；用户只需安装本 Skill。公开的 [Agent 部署指引](https://cellapp.ai/deploy/AGENTS.zh-CN.md) 提供简要部署流程；本 Skill 更详细地说明数据和失败恢复。如果用户或环境提供自定义来源，就使用该来源；否则客户端默认连接 `https://cellapp.ai`，并迁移来源恰好为 `https://console.cellapp.ai` 的项目关联。旧来源需要重新进行浏览器授权，旧令牌不会被复制。保留 `ohmyapp.json` 和 `OHMYAPP_ORIGIN` 的兼容行为。不要虚构其他来源，也不要把凭证存入项目。

## 运行已发布客户端

确认 Node.js 至少为 22.12，且 npm 可用。在项目目录中验证官方已发布的包：

```sh
npm exec --yes --package=@cellapp/cli@latest -- cellapp --help
```

下文的部署、数据和恢复命令都使用相同的 `npm exec --yes --package=@cellapp/cli@latest -- cellapp` 前缀。npm 会按需获取并缓存官方包；不要全局安装，也不要要求用户执行安装命令。如果 Node.js 缺失或版本不受支持、包获取失败或帮助命令验证失败，报告具体障碍并停止。不要使用 `sudo`、关闭 TLS 验证，或自行实现上传协议。客户端的升级提示应与部署结果分开说明。

## 在耗时工作前完成授权

验证客户端并确定项目控制来源后，在长时间开发或构建前运行 `npm exec --yes --package=@cellapp/cli@latest -- cellapp apps --project <project>` 检查授权。已有凭证会被复用；没有凭证时会启动设备授权。验证链接和代码出现后立即交给用户，并在用户通过浏览器批准期间保持命令运行。若已有凭证返回 401，使用相同 npm 前缀、项目和来源运行 `cellapp login`，再重试 `cellapp apps`。若验证码在批准前过期，等用户准备好后重新登录并发出新链接和代码；不要把过期码留作下一步。不要索取密码，也不要把聊天回复当作浏览器批准。授权成功后再开始耗时工作。

## 检查项目

读取已有的 `cellapp.json`、构建命令、静态输出目录，以及可能存在的 `cellapp.data.json`。更新应用时复用现有关联。无需构建的普通 HTML 省略构建命令。只有输出目录或构建设置不明确时才询问。Cellapp 托管静态前端代码；不要部署 SSR、自定义服务器、私密服务密钥、直连 PostgreSQL 的凭证或任意 SQL。获准访问的访客可以读取打包后的前端内容。

## 需要开发界面时

如果用户要求开发或大幅重新设计应用，而没有提供 UI 方向，阅读[用户应用设计指导](https://cellapp.ai/deploy/app-design.zh-CN.md)，直接采用其中适合的建议，不必询问用户是否启用。用户明确的设计要求和项目已有约定优先。根据应用选择框架和样式方案，不要强加 Cellapp 的外观或特定样式库。如果暂时无法读取指导，仍继续建立清楚的视觉层级、响应式布局和可访问控件，并检查构建后的界面。仅部署现有应用的任务不要求重新设计。

## 选择应用标识

显示名称可以重复。每个所有者有一个公开的用户 slug（在 API 和 CLI 中称为 `namespace`），应用 slug 在该用户 slug 下必须唯一。首次部署时，新所有者可以选择 `--namespace <user-slug>`；每个新应用可以选择 `--slug <app-slug>`。两者均使用小写 ASCII 字母、数字和连字符，且以字母开头。用户 slug 至少为三个字符；`accounts`、`cloud`、`login` 和 `app` 等保留名称不可用；`{app-slug}-{user-slug}` 必须能放入一个不超过 63 个字符的 DNS 标签。未指定时，Cellapp 会分配保护隐私的用户 slug，并根据显示名称生成应用 slug；冲突时会添加后缀。已有用户 slug 的所有者通过 CLI 创建应用时，必须复用既有用户 slug。控制台可在创建后修改两种 slug。返回地址使用 `{app-slug}-{user-slug}.<apps-domain>`；旧地址仍归原应用所有。`@user-slug/app-slug` 分享链接会重定向到当前主机。不要把 slug 或显示名称当作授权身份；应用访问和数据表始终绑定不可变的应用 ID。

## 规划、应用和验证数据表

有版本且不包含秘密的 [`cellapp.data.json`](examples/notes/cellapp.data.json) 清单定义数据表、列、主键、索引和操作策略。类型包括 `text`、`uuid`、`bigint`、`boolean`、`timestamptz`、`jsonb`。策略模式包括 `none`（默认）、`all-admitted-users`、`own-rows`。`own-rows` 模式需要非空的文本型 `ownerColumn`；读写操作会与已登录的应用用户 ID 比对。每张表都需要主键。清单中不能包含 SQL、函数、触发器、数据库密码或提供方身份。表名按应用隔离：一个应用可以定义 `users`，而不影响平台用户或其他应用的同名表。它只是普通应用数据，不是平台身份来源。同一应用内名称必须唯一；`rpc` 为未支持的 PostgREST 路由保留，PostgreSQL 系统列名不可用，生成的索引名也不能与表名冲突。应用前用 `data plan` 检查这些规则。

公开表单只给目标表增加 `policies.anonymousInsert: "all"`；确实允许访客读取记录时才增加 `anonymousSelect: "all"`。未填写即拒绝匿名访问。应用新版清单后，所有者运行 `cellapp anonymous set <app-id> --pages true --read false --write true`，或在控制台设置；运维仍须单独开启匿名提交总开关。用 `cellapp anonymous get <app-id>` 查看实际状态。用未登录浏览器打开页面并提交一次，确认仅新增的响应不包含行内容，匿名 GET/PATCH/DELETE 和错误 Origin 的 POST 均被拒绝。页面中不得放数据库凭证或高权限 JWT。

新项目先完成首次静态部署，以便在 `cellapp.json` 中建立应用关联。先构建并部署一次前端，然后使用已关联的应用和配置的来源应用数据清单。验证成功前，不要报告依赖数据表的页面已准备就绪：

```sh
npm exec --yes --package=@cellapp/cli@latest -- cellapp data status --project <project>
npm exec --yes --package=@cellapp/cli@latest -- cellapp data plan --project <project>
npm exec --yes --package=@cellapp/cli@latest -- cellapp data apply --project <project>
npm exec --yes --package=@cellapp/cli@latest -- cellapp data verify --project <project>
```

首个清单版本为 `1`，以后每次恰好加一。数据计划和版本应与静态发布版本分开检查。相同内容重试是安全的；已应用版本的内容发生变化会返回冲突。删除表或列时，在清单中设置 `allowDestructive: true`，审查计划和备份影响后，再向 `data apply` 传入 `--allow-destructive`。超时后先运行 status 和 verify，必要时重试同一清单；不要为重试创建新版本。给已有数据的表增加非空列会失败并回滚；在当前支持范围内，先使用可空列。

新数据表和操作默认拒绝前端访问，直到明确授予权限。使用所有者凭证应用清单。交付应用地址前，分别验证一个允许的操作，以及一个跨用户或未授权而被拒绝的操作。区分仅针对数据库的测试与真实浏览器和 PostgREST 验收。应用数据库与控制数据及其他应用隔离；应用代码无法获得数据库密码。

## 连接静态前端

应用前端使用官方 `@cellapp/sdk` 获取当前应用用户及已声明支持的表操作。于 Cellapp 发布的 HTML 页面中调用 `createCellappClient()`，再用 `currentUser()` 获取稳定的应用范围用户 ID；`from(table)` 仅使用文档列出的 select/insert/update/delete、eq、order、range 和写后 select。应用域公开接口统一在 `/_cellapp/` 下，包括 `/_cellapp/me` 和 `/_cellapp/db/{table}`；应用代码不要直接请求 `/rest/v1`。SDK 使用应用域会话及构建时固定的 API 契约，不提供 Supabase Auth、Realtime、Storage、Functions、RPC 或数据库直连。不要暴露或推导全局 Cellapp ID，也不要把所有者凭证写进前端。未显式选择版本时，CLI 把平台当前默认稳定契约写入输出 HTML；项目或 `--api-version` 可选择受支持的 `major.minor` 或等价的 `yymmdd` 别名。不带版本的直接请求走最新版；静态回滚恢复旧 HTML 中固化的版本。开发和排障时阅读[API 版本说明](https://cellapp.ai/deploy/api-versions.zh-CN.md)与[changelog](https://cellapp.ai/deploy/api-changelog.md)。可参考[可运行笔记示例](examples/notes/README.md)。

只使用 `.from(table).select(columns)`、`.insert(values)`、`.update(values)`、`.delete()`、`.eq()`、`.order()`、`.range()`，以及写入后用于返回记录的 `.select()`。明确处理 `{data,error}` 与 401/403 状态。本期不支持 Supabase Auth、Realtime、Storage、RPC、Edge Functions、联表、任意过滤器、直连数据库或自定义应用服务器。网关忽略客户端传入的授权和 profile 请求头。公开应用允许任何已登录 Cellapp 用户进入，但数据表仍受策略控制。受限应用在登录后还需要所有者批准或兑换访问密钥。

## 发布与报告

运行 `npm exec --yes --package=@cellapp/cli@latest -- cellapp deploy --project <project> --output <output-directory> --build <existing-build-command>`；首次部署时可选传入 `--namespace` 和 `--slug`。普通 HTML 如果不需要构建，则省略 `--build`。仅当应用使用客户端路由时添加 `--spa`。如果部署时仍启动设备授权，立即将新的验证链接和代码交给用户，并在用户通过浏览器批准期间保持命令运行；若验证码过期，取得新码后再重试。仅在返回 `status: published` 后报告发布成功。数据版本及其验证结果应与静态版本分开报告，最后提供应用地址。

首次部署只返回一次访问密钥。仅交给提出请求的所有者；不要写入 URL、仓库、Issue 或项目状态。旧密钥只能在平台登录后兑换。`cellapp reset-key <app-id>` 会轮换后续兑换所用密钥，已有用户授权仍有效。可在所有者控制台撤销单个授权。仅在用户要求时才重置密钥或删除应用。初始密钥丢失后，可以按明确要求进行轮换。

暂时性上传或网络失败时，对同一部署命令重试一次：待完成的项目元数据会复用原操作。再次失败后停止并报告错误。发布版本冲突需要人工检查。创建时若返回 `app_data_not_ready`，保留 `cellapp.json`，查看 `cellapp data status --project <project>`；平台数据服务恢复后运行 `cellapp data reconcile --project <project>`，再重试部署。不要通过更换 slug 或删除应用规避此错误。对于没有 `cellapp.json` 的旧版 CLI 项目，先用 `cellapp apps` 验证所有者拥有的应用 ID，再运行 `cellapp link <app-id> --project <project> --output <output-directory>`。CLI 在首次发布成功前，只把初始访问密钥保存在私有凭证目录；不要复制到项目文件。遇到数据错误时使用 `data status` 和 `data verify`；数据 API 尚不可用时，不要声称依赖数据表的前端已经就绪。仅存于浏览器本地的数据不会跨设备同步；受管理的数据表数据可以。
