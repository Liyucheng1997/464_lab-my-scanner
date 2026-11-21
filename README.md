# 扫描仪

一个装在手机 / iPad 主屏幕上的文档扫描网页应用：对准文件自动识别边缘并拍摄，校正成平整的页面，导出 PDF，多台设备之间自动同步。

线上地址：https://scan.liyucheng.me

## 功能

- 实时相机：边拍边识别纸张边缘，画面稳定后自动拍摄
- 手动调整四角、透视校正，增强 / 黑白 / 灰度 / 原图四种效果
- 多页文档，导出 PDF 或图片，支持系统分享
- 多设备同步：手机扫完，电脑上直接能看到（设一个同步密码即可）
- 首页按日期分组、带序号，可切换排序
- 可离线使用，支持深色模式

## 安装到 iPad / iPhone

用 Safari 打开线上地址 → 分享 → “添加到主屏幕”。

## 本地运行

需要 Node 22 以上，没有任何依赖：

```
node server/server.js
```

然后打开 http://127.0.0.1:5173 。数据保存在 `data/` 目录。

## 部署

推送到 `main` 分支后，服务器会在一分钟内自动拉取并重启（见 `deploy/pull.sh` 和 `deploy/app-scanner-pull.timer`）。

## 目录

- `index.html`、`css/`、`js/`、`sw.js`：网页应用（原生 JS，无构建步骤）
- `server/server.js`：同步服务端（零依赖）
- `deploy/`：服务器上的 systemd、nginx 配置和更新脚本

源码仓库：https://github.com/Liyucheng1997/scanner-pwa
