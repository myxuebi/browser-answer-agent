# 答题 Agent 隐私说明 / Privacy Policy

[中文](#中文) · [English](#english)

更新日期 / Last updated: 2026-11-20

开发者 / Developer: myxuebi

项目与联系方式 / Project and contact: [GitHub](https://github.com/myxuebi/browser-answer-agent) / [Issues](https://github.com/myxuebi/browser-answer-agent/issues)

## 中文

### 读取与用途

用户点击分析或启动自动答题后，扩展读取当前网页及可访问内嵌页面的 HTML、可见文字、相关元素属性、选中状态和可操作文本输入框的当前内容，用于识别题目、生成答案、模拟点击或输入，以及判断和核对下一题。自动答题会持续读取同一标签页，直到结束、停止或发生错误。

脚本、样式、隐藏内容和网页事件代码会从发送的 HTML 中移除，但这种清理并非通用的敏感信息脱敏；网页可见文字和输入内容中仍可能包含个人信息。请自行决定哪些网页适合交给模型处理。

勾选「当前模型支持读图」后，扩展还会读取并发送浏览器允许访问的已加载网页图片，单次最多六张。扩展不截取整页截图，也不申请摄像头或麦克风权限。

### 发送到哪里

上述数据通过用户配置的 API 地址发送到用户选择的模型服务。请求会包含模型名称、可选推理设置和身份验证所需的 API Key；Key 作为该 API 请求的鉴权信息发送，不作为网页数据写入提示词。远程地址要求 HTTPS，本机回环服务可使用 HTTP。

连续答题时，为区分原题与新题，还会发送上一题页面的 HTML 与已答题干。模型服务提供方会接收到请求，具体存储、训练使用及保留期限取决于该服务的条款。Responses 请求设置 `store: false`，但这不能替代服务商的数据处理承诺。

当前版本没有开发者自建的数据收集服务，不向开发者发送网页、Key 或运行日志，没有广告、分析统计或浏览历史采集功能。第三方 API 可能根据其服务规则记录请求；开发者无法控制其存储和删除。

### 本地保存

- API 地址、模型名、读图与推理选项，以及 API Key 保存在当前浏览器用户配置的扩展本地存储中，不使用浏览器同步。
- API Key 使用浏览器扩展存储保存，不提供额外的密码加密保险库；设置界面以密码框遮挡显示，网页内容脚本不被授予该本地存储的访问权限。
- 最近三百条运行日志按标签页保存在浏览器会话存储中；浮窗也会显示启用后收到的日志。日志可包含题干、模型解释、准备输入的答案、点击目标和错误信息，不主动记录 API Key、请求头或完整 HTML。
- 使用「复制日志」会把当前日志写入用户剪贴板；用户分享日志时应先检查其中的网页和答题内容。

### 权限

- 所有 HTTP / HTTPS 站点：在用户启动答题后读取目标网页，并连接用户配置的模型服务。
- scripting：为网页元素编号并执行点击、输入等操作。
- storage：保存设置、Key 和会话日志。
- sidePanel：显示扩展侧栏。
- contextMenus：在工具栏右键菜单中切换入口。
- offscreen：使用扩展内置 Worker 处理网页浮窗的模型请求。

扩展不会自动扫描所有后台标签页；站点访问权限不意味着上传全部浏览历史。

### 清理与删除

清空设置中的 API Key 后点击保存，可删除已记住的 Key。运行日志可在侧栏清空，会话存储也会在浏览器会话结束后清除。卸载扩展可以移除浏览器为本扩展保存的数据；这不会删除已发送到模型服务的数据。如需删除服务端数据，请联系相应提供方。

### 变更和反馈

后续功能变更涉及的数据处理会同步更新本说明。问题可通过项目 Issues 联系开发者，反馈中不要附带密钥、私人页面或其他敏感资料。

## English

### Data Access and Purpose

After the user clicks Analyze or starts an automatic answering task, the extension reads HTML, visible text, relevant element attributes, selection states, and the current contents of supported text input fields from the task webpage and accessible embedded frames. This information is used to identify questions, generate suggested answers, simulate clicks or text input, and identify and verify the next question. An automatic task continues reading the same tab until it finishes, is stopped, or encounters an error.

Scripts, styles, hidden content, and webpage event-handler code are removed from the HTML sent to the model. This processing is not a general-purpose sensitive-data redaction system: visible text and input contents may still contain personal information. Users should decide which webpages are appropriate to share with their chosen model service.

When the user enables image support, the extension also reads and sends loaded webpage images that the browser permits it to access, up to six images per request. The extension does not capture full-page screenshots or request camera or microphone access.

### Data Transmission and Recipients

The information described above is sent to the model service selected by the user through the configured API endpoint. Requests include the model name, optional reasoning settings, and the API key needed to authenticate with that service. The API key is sent as authentication information for that API request, not included in the prompt as webpage data. Remote endpoints require HTTPS; local loopback services may use HTTP.

During continuous answering, requests also include the previous question page's HTML and the answered question text to distinguish the previous question from a new one. The model service provider receives these requests. Its storage, training use, and retention practices are governed by that provider's terms. Responses API requests set `store: false`, but this setting does not replace the provider's own data-handling commitments.

The current version has no developer-operated data collection service. It does not send webpage content, API keys, or execution logs to the developer and does not include advertising, analytics, or browsing-history collection features. Third-party API services may log requests under their own policies; the developer does not control their storage or deletion.

### Local Storage

- The API endpoint, model name, image and reasoning preferences, and API key are saved in extension-local storage within the current browser profile. Browser synchronization is not used.
- API keys are stored using the browser's extension storage, without an additional encrypted password vault. The settings interface masks the key in a password field. Webpage content scripts are not granted access to this local storage.
- The most recent 300 execution log entries are stored per tab in browser session storage. The floating interface also displays entries received after it is enabled. Logs may contain question text, model explanations, answers prepared for input, click targets, and error messages. The extension does not intentionally log API keys, request headers, or complete HTML.
- Clicking Copy Logs writes the current logs to the user's clipboard. Users should review webpage and answer content in logs before sharing them.

### Permissions

- Access to all HTTP/HTTPS websites: read the task webpage after the user starts a task and communicate with the user-configured model service.
- `scripting`: assign identifiers to webpage elements and perform clicks, text input, and related task actions.
- `storage`: save settings, API keys, and session logs.
- `sidePanel`: display the extension's side panel.
- `contextMenus`: switch interfaces using the extension toolbar context menu.
- `offscreen`: use a packaged Worker to process model requests initiated from the webpage floating interface.

The extension does not automatically scan all background tabs. Host access does not mean that the user's complete browsing history is uploaded.

### Clearing and Deleting Data

To delete a remembered API key, clear the API Key field in settings and save. Execution logs can be cleared in the side panel. Session storage is also cleared when the browser session ends. Uninstalling the extension removes the data the browser stores for it; this does not delete information already sent to a model service. To request deletion of service-side data, contact the relevant provider.

### Changes and Contact

This policy will be updated when feature changes affect data handling. Questions can be submitted through the project's [Issues](https://github.com/myxuebi/browser-answer-agent/issues). Do not include API keys, private webpages, or other sensitive information in public reports.
