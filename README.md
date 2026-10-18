# TrainTrace

记录每一组，让下一次训练有所依据。TrainTrace 是一个面向日常力量训练的轻量 Web App：在浏览器中记录真实完成情况，用历史对比和保守规则衔接下一次训练。无需账号，支持手机与电脑。

**[打开 TrainTrace](https://cocobolo111-png.github.io/TrainTrace-Coach/)** · 当前为 **V1.3 发布候选版（1.3.0-rc.2）**，稳定标签待人工验收后创建。

## 能做什么

- 按目标、器械、时间与近期历史生成精简候选计划；支持复训模式。
- 逐组记重量、次数与可选感受，支持休息计时、暂停/恢复与中断后继续。
- 查看历史与同版本动作对比；区分已完成组、计划组、热身与未知数据。
- 提供即时规则反馈，不将单次下降误判为平台期，不从缺失数据推断能力进步。
- 导出 JSON 完整备份、合并导入备份，或预览导入明确格式的 Markdown 历史。
- 首次在线加载后可离线记录，支持添加到主屏幕或安装为桌面应用。

它不提供账号、云端训练数据库、跨设备同步或公共 AI 服务。训练建议不替代医疗诊断或治疗。

## 手机与桌面使用

首次打开先完成引导和训练偏好设置。选择计划后开始记录，训练结束查看总结与下一步建议。新用户没有预置训练、个人偏好或分析历史。

- **iPhone / iPad**：用 Safari 打开网页，分享 → 添加到主屏幕。参见 [Apple 使用说明](https://support.apple.com/guide/iphone/iphea86e5236/ios)。
- **Android**：用 Chrome 打开网页，从浏览器菜单选择安装应用或添加到主屏幕。
- **电脑**：Chrome / Edge 菜单中选择安装此网站为应用，或创建网站快捷方式。参见 [Chrome 网页应用说明](https://support.google.com/chrome/answer/9658361)。普通浏览器标签页同样可用。

安装菜单与功能名称随浏览器和系统版本而异。首次请联网打开并等待资源加载，再使用离线记录。新版本就绪时会提示刷新，训练进行中不主动刷新；旧版若仍被缓存，结束训练后关闭本站全部标签页/应用窗口再重新打开，**无需清理浏览器数据**。

## 数据与隐私

训练事实和偏好只保存在**当前浏览器、当前站点的 IndexedDB**；提醒开关等展示设置在本地 localStorage。不同浏览器、设备和站点来源彼此独立，不会自动同步。分享网址不会分享你的训练数据。

清理站点数据、卸载浏览器、更换设备或浏览器存储被回收，都可能导致记录丢失。请定期在「设置 → 数据管理」导出完整备份，并将文件保存到浏览器之外。换设备后手动导入；同 ID 不同内容会阻止合并，避免静默覆盖。

公开仓库、网页产物及离线缓存仅包含代码、通用素材与明确标注的合成测试夹具，不包含开发者的训练日志、演示数据库、个人偏好、私有备份、API Key 或真实 AI 分析。仓库内 `traintrace-coach/` 的用户档案模板全部为空，可独立使用。

## 克隆与本地运行

需要 Node.js **22.12+** 和 pnpm **10.17.1**。

```sh
git clone https://github.com/Cocobolo111-png/TrainTrace-Coach.git
cd TrainTrace-Coach
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本机地址。首次运行是空白状态；它不会扫描电脑中的训练文件，也不会自动导入开发者数据。开发模式保留本地 AI 入口；未配置/启动代理时，规则反馈与训练记录仍可使用。

```sh
# 与 GitHub Pages 相同的公开静态版本：无 AI 入口，不请求模型
pnpm build
pnpm preview
```

## 可选：本地 DeepSeek 分析

GitHub Pages 只提供静态 App，**不运行模型代理、不请求 localhost、不提供公共额度或公共 AI 接口**。详细 AI 分析仅在开发模式或显式本地构建中启用。

```sh
cp .env.example .env.local
# 用编辑器在 .env.local 中填写你自己的 DEEPSEEK_API_KEY
pnpm build:local
pnpm build:server
pnpm start
```

默认打开 `http://127.0.0.1:8787/`。此服务只绑定本机；不要将其作为公共代理部署。`pnpm dev` 的同源分析请求也会转发到这个本机代理。

密钥只由 Node 服务读取，不写入 `VITE_` 变量、前端代码、备份或 Git。`.env.local` 已被忽略；可选 `DEEPSEEK_MODEL` 指定官方模型，默认沿用 `deepseek-flash`。首次点击详细分析才将必要记录发送至 DeepSeek 官方 API，可能产生费用；失败时保留规则反馈，不自动重试。

服务端重算统计与规则，只附加0–2条相关解释素材；缺少证据时保留原反馈。成功解释为本地派生缓存，不修改训练事实，不进入训练备份。`dist/` 是公开构建，`dist-local/` 是本地 AI 构建，二者分开输出。切换端口/浏览器会形成独立数据来源，需自行通过备份迁移。

## 验证与发布

```sh
pnpm test
pnpm build
pnpm build:local
pnpm build:server
pnpm exec playwright install chromium
pnpm test:e2e
```

浏览器测试分别覆盖公开静态版与本地版，使用隔离浏览器和合成夹具，不读取私人日志。显式真实 API 验证可运行 `pnpm verify:deepseek /私有路径/训练备份.json --explainer`；需要你自己的密钥和数据，不在 CI 执行。

GitHub Actions 使用冻结锁文件安装，运行测试及两种前端/服务端构建，仅发布 `dist/` 到 Pages；不会部署 `dist-local/`、`dist-server/` 或本地环境文件。实体手机安装、系统后台与提示音等体验需按实际设备验收，浏览器模拟不等于真机确认。

## 许可

代码采用 [MIT License](LICENSE)。训练解释素材中的讲师表述保留来源标注，不代表官方授权、代言或效果保证；AI 整理与原创类比有独立标记。
