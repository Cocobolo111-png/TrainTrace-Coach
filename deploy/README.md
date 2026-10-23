# V1.4 Beta 部署与回滚

已获用户上线批准，2026-10-23 已部署完整 BYOK 版：https://train.byheyang.cn/ 。应用 Commit 为 `88295cece12ae93060975ea4b0e5147f85af43b6`。GitHub Pages 同时发布 V1.4 静态版。以下保留部署方案，批准关口已完成；实际验证状态见 [上线记录](../docs/v1.4-launch.md)。

2026-10-23 只读 SSH 复核：现有阿里云 Ubuntu 上 Caddy 与 Love Journal 服务均 active；Node v24.21.0；Caddyfile 使用 `/etc/caddy/sites-enabled/*.caddy`；已有 love-journal 与 portfolio 站点；127.0.0.1:3101、2019 已占用，8788 未占用。不安装新代理，不替换现有 Caddyfile，不操作现有数据。

## 两种发布物

- `pnpm build` → `dist`：静态/PWA/规则反馈，可部署 GitHub Pages；设置中说明个人 AI 需要完整版，不连接任何 API。
- `pnpm build:byok` + `pnpm build:server` → `dist-byok` + `dist-server`：HTTPS 同源 Node 版，连接自己的 DeepSeek Key。Node 使用生产依赖（按锁文件安装），绑定 127.0.0.1:8788，Caddy 终止 HTTPS。不得将私人 local-ai 构建作为公共服务。

## 人工验收后的隔离部署步骤

1. 再次只读检查端口、Node 路径、Caddy 状态、现有配置和域名 DNS。示例 Node 路径必须与 `command -v node` 一致。
2. 使用专用无登录用户 `traintrace`、独立 `/srv/www/sites/traintrace/releases/<commit>/`。上传只包含 `dist-byok/`、`dist-server/`、package.json 和 pnpm-lock.yaml 的白名单构建包；不上传 `.env*`、私人日志、浏览器数据库或 macOS node_modules。在 Linux 执行 `pnpm install --prod --frozen-lockfile --ignore-scripts`，核对 SHA256。
3. 检查 [systemd 模板](traintrace.service.example) 后安装为独立服务，`current` 指向候选目录；保留上一个目录和链接以便回滚。用 SSH 隧道检查静态页面；BYOK API 仍要求正式 HTTPS Origin，不为隧道放宽校验。
4. 先用现有 Caddy 二进制对 [独立站点模板](traintrace.caddy.example) 执行 `caddy adapt/validate`。不自动复制到 sites-enabled，不 reload，不改 DNS。Caddy 的原有站点继续工作。
5. 人工批准后才添加 `train.byheyang.cn` 记录与独立站点配置、校验证书并平滑 reload Caddy。核验 HTTPS、非本站 Origin 拒绝、无 Key 拒绝、无默认模型请求、真实连接及训练分析。检查其他站点仍正常。
6. 回滚只退回 TrainTrace 的 current 链接或禁用其独立站点；不改其他站点。不要清理任何用户的浏览器数据。

配置不启用访问日志，应用不记录请求体、凭证或原始模型错误。若现有基础设施另有调试/审计/访问日志，启用前确认 Authorization、请求体、查询参数不被记录。不能声称服务端完全不接触密钥：Key 经本站服务器临时转发，服务不保存。

## 运维边界

- 公共模式默认启用 BYOK；没有精确 HTTPS `PUBLIC_ORIGIN` 则启动失败。`start:byok` 不加载 `.env.local`；即使环境中有开发者 Key 也不作为兜底。
- Node API 只接受回环 TLS 终结代理、精确 Host/Origin、HTTPS 转发标记；无 CORS。Caddy 必须覆盖 X-Forwarded-Proto，不能透传客户端自述标记。
- 单体轻量限额：全服务同时 2 个请求；每个凭证 12 次/分钟、回环代理总计 60 次/分钟；频率状态只在内存中，重启清空。朋友较多时可能排队失败，不是公共模型配额服务。
- 分析超时 35 秒、连接测试 12 秒、请求体最多 256000 字节。无自动模型重试，失败保留规则反馈。
- PWA 只预缓存版本化资源，不缓存 API。更新完成后提示，训练中不强制刷新。不同协议/主机/端口的 IndexedDB 独立；GitHub Pages → 新域名须用户主动导出/导入，不自动迁移。
- 真实手机 Safari/Android 安装、正式证书与公网网络、实际缓存跨版本更新仍需人工验收。不要用本地测试证书部署公网。

## 当前服务与回滚命令

- 服务：`traintrace.service`，专用无登录用户 `traintrace`，开机启动，仅监听 `127.0.0.1:8788`；无开发者凭证、无 EnvironmentFile。
- 版本目录：`/srv/www/sites/traintrace/releases/88295cece12a/`；`current` 原子链接指向该目录，内有构建 SHA256 清单及 `dist-byok/release.json`。
- 独立 Caddy 配置：`/etc/caddy/sites-available/traintrace.caddy`，由 sites-enabled 同名链接启用。复用现有证书存储和自动续期，不替换其他站点配置。
- 已安装 [发布/回滚脚本](traintrace-release.sh) 为 `/usr/local/sbin/traintrace-release`，只有 root 可执行发布操作。

```sh
sudo /usr/local/sbin/traintrace-release rollback
```

这是该域名首次服务端发布，**没有旧的服务器 TrainTrace 版本或 previous 链接**。首次回滚会撤下独立 Caddy 站点、校验并平滑 reload Caddy，然后停止并禁用 TrainTrace 服务；保留 DNS、版本目录及其他站点，GitHub Pages 静态版继续可用。首次撤回与恢复已实际演练。

未来激活不同 release 后，脚本会保存 `/srv/www/sites/traintrace/previous`，`rollback` 即切回上一 release 并重启 TrainTrace。若激活健康检查失败，会恢复可用的旧链接。代码历史中的上一版本保留于 Git Commit `28e06f6`，并非伪造的服务端 previous。

首次撤回后恢复本次发布：

```sh
sudo /usr/local/sbin/traintrace-release activate 88295cece12a
sudo ln -s /etc/caddy/sites-available/traintrace.caddy /etc/caddy/sites-enabled/traintrace.caddy
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

只在同名 sites-enabled 链接确实不存在时重建，先校验再 reload。发布脚本不修改浏览器 IndexedDB，也不迁移或上传训练数据。
