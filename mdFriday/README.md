## 产品介绍

**MDFriday** 是一款数字资产创作助手。在 Obsidian 中写作，跨设备同步，即时发布为专业网站。内置 500+ 精美主题，覆盖文档、博客、简历、作品集、幻灯片等场景。

## 主要功能

- **即时发布**：在 Obsidian 中编写 Markdown，一键发布为专业网站。
- **多设备同步**：通过 CouchDB 实现跨设备实时同步，随时随地写作。
- **丰富主题**：500+ 精美主题，涵盖文档、博客、简历、作品集、幻灯片等。
- **自动 HTTPS**：集成 Caddy 自动申请和管理 SSL 证书，支持 DNSPod。

## 使用说明

### 基础配置

安装后需要填写以下关键信息：
- **域名**：你的服务器域名
- **服务器 IP**：服务器公网 IP 地址
- **管理员邮箱和密码**：用于登录 MDFriday 管理后台
- **CouchDB 用户名和密码**：数据库凭据

### 启用 DNSPod（可选）

如需自动 HTTPS 证书管理：
1. 将 `DNSPOD_ENABLED` 设置为 `true`
2. 填写 `DNSPOD_ID` 和 `DNSPOD_SECRET`（在 DNSPod 控制台获取）

### 访问服务

部署完成后：
- **主站**：`http://你的服务器IP:${PANEL_APP_PORT_HTTP}`
- **CouchDB 管理**：`http://你的服务器IP:${PANEL_APP_PORT_HTTP}/_utils`（通过 cdb 子域名）
