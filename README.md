# 💊 药小记 PWA — 家庭药品管理

纯前端家庭药品管理 & 就医记录工具。数据完全存储在你自己的设备上，不上传任何服务器。

## ✨ 功能

- 📦 **药品管理** — 记录药品名称、分类、功效、过期日期、数量
- 👨‍👩‍👧‍👦 **家庭成员** — 每位家庭成员独立管理
- 📝 **就医记录** — 记录医生、诊断、处方、效果评分、副作用
- 📷 **拍照识别** — 拍药品包装自动识别（需通义千问 API Key）
- 📋 **处方识别** — 拍处方单自动填入就医记录
- 🔍 **过期提醒** — 自动标记过期和即将过期的药品
- ✅🚫 **有效/避雷** — 标记药方是否有效，标记要避雷的医生
- 🎤 **语音录入** — 支持 Chrome/Safari 语音输入
- 📱 **离线可用** — PWA 架构，安装后无需网络
- 💾 **数据备份** — 一键导出/导入 JSON 文件

## 🚀 部署指南

### 方式一：本地直接打开（最简单）

1. 下载整个 `medicine-cabinet/` 文件夹
2. 双击 `index.html` 用浏览器打开
3. 点击浏览器地址栏右侧的"安装"图标，添加到桌面

> ⚠️ 本地打开时 Service Worker 不可用，不影响核心功能

### 方式二：本地 HTTP 服务器（推荐）

```bash
# 方法 1：Python（已安装的话）
cd medicine-cabinet
python -m http.server 8080

# 方法 2：Node.js
npx serve medicine-cabinet

# 方法 3：VS Code
# 安装 Live Server 扩展，右键 index.html → Open with Live Server
```

然后打开 `http://localhost:8080` 即可。

### 方式三：GitHub Pages（免费，推荐给朋友部署）

1. 创建一个 GitHub 仓库（如 `my-medkit`）
2. 将 `medicine-cabinet/` 中的所有文件推送到仓库根目录
3. 进入仓库 Settings → Pages → Source 选择 `main` 分支
4. 访问 `https://你的用户名.github.io/my-medkit/`

**朋友部署步骤：**
- Fork 你的仓库 → 按同样步骤开启 Pages → 完成！

### 方式四：Vercel（免费）

1. 将代码推到 GitHub 仓库
2. 去 [vercel.com](https://vercel.com) 导入该仓库
3. 点击 Deploy，自动获得一个公开 URL

## 📱 安装到手机桌面

打开网页后：

- **iOS Safari**：点击底部"分享"按钮 → "添加到主屏幕"
- **Android Chrome**：点击右上角菜单 → "添加到主屏幕"或"安装应用"

安装后，图标会出现在手机桌面上，打开后像原生 App 一样全屏运行。

## 💾 数据存储

- 所有数据保存在浏览器的 **IndexedDB** 中
- 照片压缩后以 base64 存储（单张约 50-100KB）
- 存储容量通常可达数百 MB（取决于设备）
- **数据不会上传到任何服务器**

### 备份数据

设置 → 📤 导出数据 → 保存 JSON 文件

### 恢复数据

设置 → 📥 导入数据 → 选择 JSON 文件

> ⚠️ 换浏览器或清除浏览器数据会丢失所有记录，请定期导出备份！

## 🛠 技术栈

- 纯 HTML / CSS / JavaScript（无框架）
- Tailwind CSS（CDN）
- IndexedDB（本地数据存储）
- Service Worker（离线缓存）
- 通义千问 VL API（拍照识别，可选）

## 📄 文件结构

```
medicine-cabinet/
├── index.html      # 主页面
├── app.js          # 全部业务逻辑
├── sw.js           # Service Worker（离线缓存）
├── manifest.json   # PWA 配置
├── icon.svg        # 应用图标（SVG）
├── icon-192.png    # 应用图标 192px
└── icon-512.png    # 应用图标 512px
```

## 📜 License

MIT
