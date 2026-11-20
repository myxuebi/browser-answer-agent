# Chrome / Edge 商店提交资料

资料版本：0.5.2；核查日期：2026-11-20。此文件是提交准备资料，不表示已经上架或获得审核通过。

## 扩展包

将 `extension/` 内的全部文件打成 ZIP，根目录直接包含 `manifest.json`。不包含开发者浏览器配置、API Key、Git 元数据、demo 或本地日志。

- 名称：答题 Agent
- 版本：0.5.2
- 开发者：myxuebi
- 简介：自定义 AI 模型分析网页 HTML，预览答案、模拟点选和输入，并自动继续下一题。
- 首页：https://github.com/myxuebi/browser-answer-agent
- 支持：https://github.com/myxuebi/browser-answer-agent/issues
- 隐私政策：https://github.com/myxuebi/browser-answer-agent/blob/main/PRIVACY.md
- 图标：`extension/icons/128.png`
- 界面截图：`docs/screenshot.png`

## 商店介绍

答题 Agent 是可连接自定义大模型的网页练习助手。它将当前网页的 HTML 与带编号的元素发送到用户指定的模型接口，提供答案预览、模拟点选、文本输入和连续下一题操作。

支持功能：

- Chat Completions 与 OpenAI Responses 接口，自定义 API 地址、模型名和 API Key。
- 服务默认、低、中、高思考深度；可选视觉输入与 Responses 推理摘要。
- 在侧栏先预览答案，再决定应用哪些建议。
- 自动点选单选、多选，填写文本框、文本域和富文本输入区。
- 自动判断下一题／下一页；翻页后核对新题原文，避免对同一道题反复作答。
- 侧栏、网页悬浮窗和半透明圆点三种入口。
- 实时日志、复制日志、一键停止；API Key 保存在本机。

使用者需自行配置模型服务，第三方服务可能计费。模型答案可能有误；图片读取、复杂控件及特定网站可能受浏览器和网页实现限制。仅用于练习或经授权的场景。

Powered by myxuebi

## 单一用途和权限说明

单一用途：使用用户配置的大模型辅助当前网页练习题的识别、预览与作答。

所有站点访问用于用户启动的网页分析、可访问 iframe 中的题目、答题动作和连接可自定义的模型域名。程序不会后台读取用户未启动任务的标签页。

`scripting` 用于本地内置脚本的元素编号、点击和输入；`storage` 保存本机设置和会话日志；`sidePanel` 显示侧栏；`contextMenus` 提供入口切换；`offscreen` 启动内置 Worker 承载模型请求。所有可执行代码随扩展打包。模型只返回经过校验的 JSON 目标编号及数据，不返回或执行远程 JavaScript。

隐私表单应如实申报网页内容、交互状态、文本输入内容，以及向用户配置的第三方模型服务发送数据的行为；API Key 属于鉴权信息。不要声称扩展不处理任何用户数据。日志在本地保存，也可能含有个人信息；当前版本没有广告或分析统计。

## 审核人员本地试用

从源码仓库运行 `node demo/server.mjs`，打开 `http://127.0.0.1:8787`，接口地址填 `http://127.0.0.1:8787/v1`、模型填 `demo`，Key 留空即可使用预设模型。两种 API 协议均可试用。

`/sequence` 测试页内逐题切换，`/sequence?full=1` 测试整页跳转。也可使用审核人员自行配置的兼容模型服务测试远程调用。

## 账号与提交

### Chrome Web Store

需要 Google 开发者账号、一次性注册费用和两步验证。登录 Developer Dashboard，创建新项目，上传 ZIP，填写介绍、截图、单一用途、权限理由和数据处理信息，再提交审核。公开政策要求处理用户数据的产品提供隐私政策；截图至少一张。

### Microsoft Edge Add-ons

需要 Microsoft 账号及 Partner Center 的 Edge 开发者注册／验证；Edge 扩展计划没有注册费用。登录 Partner Center，创建扩展并上传 ZIP，补齐可用市场、介绍、图片、隐私信息及测试说明，再提交审核。

发布账号的登录、注册、验证、收费确认和商店表单仍需在对应后台完成，GitHub HTTPS 登录不能替代商店账号。此项目可以准备包和资料，但是否审核通过由商店决定。

## 官方资料

- [Chrome 注册开发者账号](https://developer.chrome.com/docs/webstore/register/)
- [Chrome 首次提交流程](https://developer.chrome.com/docs/webstore/publish)
- [Chrome 图片要求](https://developer.chrome.com/docs/webstore/images)
- [Chrome 数据和隐私政策](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Edge 开发者账号](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
- [Edge 提交流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
