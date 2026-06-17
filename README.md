# 狮子酒吧 Web

手机和电脑都能玩的多人连线版狮子酒吧。玩家打开链接、输入名字、加入同一个房间代码后即可游玩。

## 本地运行

```bash
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

打开：

```txt
http://localhost:8000
```

## Render 部署

建议流程：

1. 把 `lionsbar-web` 这个资料夹推到 GitHub repo。
2. 在 Render 选择 **New Web Service**。
3. 连接你的 GitHub repo。
4. Render 会自动读取 `render.yaml`；如果手动填写，请使用下方设置。

| 项目 | 值 |
| --- | --- |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app:app --host 0.0.0.0 --port $PORT` |

也可以直接使用仓库中的 `render.yaml` 建立 Web Service。

## GitHub 安全检查

这个网页版本不需要 Discord token，也不需要任何 API key。

上传前请确认：

- 不要上传 `.env`。
- 不要上传 `.venv/`、`.deps/`、`__pycache__/`。
- 不要把 Render、GitHub 或 Discord 的 token 写进代码。
- 如果未来需要环境变量，只在 Render Dashboard 的 Environment Variables 里设置。

## 通讯设计

- 每个房间有 4 位房间码，例如 `AB12`。
- 玩家第一次进入会在浏览器 `localStorage` 生成一个 token。
- 断线重连时，服务器用 token 找回原本的玩家座位和手牌。
- 所有游戏操作都走 WebSocket，即时广播给同房间玩家。
- 服务器推送状态时会针对每个连接分别生成资料；自己的手牌只会发给自己。
- 前端每 20 秒发送一次 heartbeat（心跳），服务器回 `pong`；超过 30 秒没收到任何消息会自动重连。
- 断线重连采用指数退避＋抖动；手机切回前台时也会自动检查并重连。
- 聊天、表情走同一条 WebSocket 即时广播；聊天最近 40 条存在房间里，重连后仍可见。
- Render 免费服务休眠或重启时，服务器内存里的房间会消失；正式长期运营时可以再接 Redis 存房间状态。

## 互动与新功能

- **质疑揭牌动画**：有人质疑时，屏幕中央翻开牌并盖上「撒谎 / 诚实」印章。
- **表情**：底部 😀 发表情，全房飘字。
- **聊天**：底部 💬 打开聊天抽屉；有新消息时按钮上会亮红点。
- **房主限时（可选）**：房主在大厅可设每回合「关闭 / 30 秒 / 60 秒」。时间到，出牌阶段自动随机出 1 张、质疑阶段自动放行。默认关闭。
- **音效与震动**：出牌、揭牌、胜利等有合成音效，可在右上角静音（部分手机支持震动）。
- **单机试玩**：首页「和机器人玩」按钮，或直接打开 `/static/lionsbar-demo.html`，离线和 3 个机器人对战（纯前端，无需联机）。

## 规则

- 2 到 6 人。
- 每人 5 点生命、每轮 5 张手牌。
- 桌面牌每轮随机为 A、K、Q。
- 出牌者每次出 1 到 3 张，并声称全是本轮桌面牌。
- Joker 永远视为正确牌。
- 下一位玩家可以质疑，或放行后继续出牌。
- 质疑成功时说谎者扣 1 点生命；质疑失败时质疑者扣 1 点生命。
- 每次质疑后重新发牌并进入新一轮。
- 最后一名存活玩家获胜。
