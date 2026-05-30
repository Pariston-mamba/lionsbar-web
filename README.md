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
- 前端每 20 秒发送一次 heartbeat，断线会自动重连。
- Render 免费服务休眠或重启时，服务器内存里的房间会消失；正式长期运营时可以再接 Redis 存房间状态。

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
