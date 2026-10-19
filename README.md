# 真理未决 · GitHub Pages 发布包

本目录包含两个独立页面：玩法介绍页和游玩桌页面。请将**本目录中的文件和 `play/` 文件夹内容放在 GitHub 仓库根目录**。

## 页面入口

- 玩法介绍：`https://你的用户名.github.io/仓库名/`
- 游玩桌页面：`https://你的用户名.github.io/仓库名/play/`

玩法介绍页顶部的「游玩页面」也会跳转到第二个页面。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个 **Public** 仓库。
2. 上传本目录内的文件，确认仓库根目录能直接看到 `index.html`、`style.css`、`app.js` 和 `play/` 文件夹。
3. 打开仓库 **Settings → Pages**。
4. 在 **Build and deployment** 中选择 **Deploy from a branch**，分支选 `main`，目录选 `/(root)`，保存。
5. 等待 GitHub Pages 发布完成，然后用上面的两个地址访问。

## 游玩页的运行说明

GitHub Pages 只托管静态文件，不会运行 `play/server.js`。因此 `/play/` 可以公开打开和浏览，但“创建房间 / 加入房间”需要牌局服务；在 `github.io` 页面上，这两个按钮会禁用并显示说明。

若要实际联机，需要把 `play/` 中的 Node 服务部署到支持常驻 Node.js 的主机，并让游玩页连接到该服务。当前服务将牌局状态保存在进程内存中；服务停止后，本局数据会消失。只把本目录上传到 GitHub，不会自动获得公网联机功能。

如果只是本机或同一 Wi-Fi 下试玩，可在 Windows 上运行 `play/start-lan.cmd`；主持人设备需要保持服务窗口开启。

## 文件内容

- 根目录的 `index.html`、`style.css`、`app.js`：玩法介绍、规则和卡牌图鉴。
- `play/`：独立游玩页面、卡牌资料、Node 房间服务和 Windows 启动脚本。
- `.nojekyll`：让 GitHub Pages 按静态文件方式发布目录内容。

