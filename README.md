
# SVAKOM SL278H · BLE 逆向 + AI 远程控制完整教程

> 从零逆向蓝牙协议，搭建 AI 远程控制系统。两种方案：安卓手机网页中继（推荐）/ Windows 电脑 Python 中继。

---

## 第一部分：逆向工程

### 1.1 反编译 APK 找协议

工具：[jadx-gui](https://github.com/skylot/jadx)

1. 下载 SVAKOM 官方 APP 的 APK
2. jadx-gui 打开，搜索 `PROTOCOL_HEADER` 或 `0x55`
3. 找到命令定义类，读取所有 `CMD_` 常量

| 常量 | 值 | 说明 |
|------|----|------|
| `PROTOCOL_HEADER` | `0x55` | 每条命令的开头字节 |
| `CMD_SCALE` | `4` | 强度控制 |
| `CMD_VIBRATE` | `3` | 振动花样 |

### 1.2 找正确的 BLE 通道（重要！）

用 nRF Connect App 扫描设备，找到两个写入通道：

- ✅ `FFE0` 服务 / `FFE1` 特征 → **控制通道（正确）**
- ⚠️ `AE00` 服务 / `AE01` 特征 → **固件 OTA 刷机口，写入可能变砖！**

验证：nRF Connect 连上设备，FFE1 手动写 `55 04 00 00 01 B4 AA`，设备有响应即正确。

### 1.3 命令格式

**强度控制**（两个设备都响应）：结论
```
[0x55, 0x04, 0x00, 0x00, 0x01, intensity(0-255), 0xAA]
```

**振动花样**（仅震动棒响应）：
```
[0x55, 0x03, 0x00, 0x00, mode(1-8), level(1-5), 0x00]
```

**停止**：
```
[0x55, 0x04, 0x00, 0x00, 0x00, 0x00, 0xAA]
```

### 实测方法论——如何验证协议是否正确

逆向只能告诉你「理论上」的命令，实际有没有用必须自己测。我们的测试流程：

**Step 1：先用 nRF Connect 手动验证**

不写任何代码，用 nRF Connect App 直接发十六进制：
1. 连上设备
2. 找到 FFE1 特征，点「Write」
3. 手动输入 `55 04 00 00 01 B4 AA`（强度约70%）
4. 设备有反应 → 通道确认正确，可以继续
5. 没反应 → 换通道或检查命令格式

这一步的目的是**排除代码问题**，先确认协议本身没问题。

**Step 2：用脚本逐一测试每个参数**

写 `test.py`，把所有命令变体跑一遍：
- 强度从低到高（30% / 60% / 100%）
- 花样1到8，各档都跑
- 每条命令之间停3秒，观察设备反应

记录格式：「命令 → 设备A反应 → 设备B反应」
例如：`CMD_VIBRATE(3, 3)` → 震动棒有反应 → 吮吸款无反应

**Step 3：发现异常立刻排查**

我们遇到的典型异常：
- 发了命令，设备动一下就停 → 不是命令错了，是缺续命机制
- 某个命令只有一个设备响应 → 正常，不同命令设备响应不同
- 扫描不到设备 → 地址随机变了，改成按名字扫描

**Step 4：用 A/B 对比实验验证机制**

`sustaintest.py` 做了严格对比：
- 测试A：发一次命令，等8秒，看设备会不会自己停
- 测试B：每1.5秒重发，跑12秒，看能不能持续

两组结果对比，才能确认「续命是必须的」，而不是靠猜。

**核心原则：每次只改一个变量**

测协议时，一次只改一个参数（比如只改强度值，其他字节不动），这样才能确定是哪个字节控制哪个功能。同时改多个参数，出了问题不知道是哪个导致的。

1. 怎么找到 BLE 服务/特征的

### 如何发现 BLE 服务结构

不要靠猜，用工具扫出来：

**方法一：nRF Connect**（最直观）
1. 连上设备
2. 点进去看所有服务列表
3. 展开每个服务，记录所有特征的 UUID 和属性（Read / Write / Notify）
4. 有「Write Without Response」属性的就是候选控制通道

**方法二：scan.py**（批量记录）
```bash
python scan.py
输出所有服务和特征，复制下来存档。

重点看：

哪个特征有 write-without-response → 候选控制通道
哪个特征有 notify → 可以监听设备反馈
UUID 里带 AE 的要格外小心（通常是 OTA）
---
**2. 怎么判断两个设备是独立地址还是共用地址的**
```markdown
### 如何判断多设备 BLE 地址关系
1. 两个设备都开机
2. nRF Connect 扫描，看出现几个条目
   - 只有一个 → 共用 MAC 地址，只能连一个
   - 出现两个不同条目 → 各自独立地址，可以分别连接
3. 用 scanall.py 也能看到同样结果
我们的型号是共用地址，所以只连一个，靠硬件联动驱动两个。
3. 怎么发现联动机制的

### 如何发现设备之间的联动关系

1. 两个设备都开机
2. 只连接其中一个（另一个不连）
3. 发 CMD_SCALE 命令给已连接的设备
4. 观察另一个设备有没有反应

如果另一个也动了 → 说明存在硬件联动（通过实体按钮或内部通信）。
linktest.py 专门做这个测试：先只发一条命令，再发不同命令，观察两个设备各自的反应。
4. 怎么确认 OTA 通道危险的

### 为什么确认 AE01 是危险通道

来源：
1. APK 反编译代码里有明确注释，AE 服务对应固件升级流程
2. BLE 社区文档（吱吱 & Veille 的逆向记录）里明确标注
3. nRF Connect 连上后，AE01 特征的描述里能看到「OTA」相关字样

验证原则：**不要用设备去验证危险操作**。这个结论来自代码分析，不是实测——实测可能变砖。
5. 怎么处理「复现不了」的情况

### 测试时复现不了怎么办

BLE 测试常见的不稳定来源：

- **设备没电**：电量低时行为异常，先充满再测
- **连接被其他设备占用**：手机 App 在后台保持连接，导致脚本抢不到 → 关掉官方 App 和手机蓝牙
- **地址变了**：重启后 MAC 地址变化，固定地址连不上 → 改用名字扫描
- **命令太快**：连续发命令间隔太短，设备来不及响应 → 每条命令之间加 sleep(0.5)
- **续命干扰**：keepalive 在后台一直发，和新命令叠加 → 测试时先停掉续命循环，测完再加回来


### 1.4 续命机制（最重要的发现！）

**问题**：发一次命令，设备只动一下就停了。  
**原因**：设备有超时保护，不持续收到命令就自动停。  
**解决**：每 1.5 秒重发当前命令（keepalive）。

### 1.5 其他发现

- **BLE 地址随机旋转**：每次开机地址不同，必须按名字 `SL278H` 扫描
- **双设备共用同一 MAC**：两件设备地址相同，只能连一个；但两个都开机时发 CMD_SCALE，两个都会响应（硬件联动）

---

## 第二部分：系统架构

```
PWA 聊天界面
    ↓ HTTPS
Next.js 服务端（解析隐藏指令）
    ↓
Railway 中继服务器（内存队列）
    ↓ HTTP 轮询（每 300ms）
BLE 中继（手机网页 or 电脑 Python）
    ↓ BLE write-without-response（FFE1）
设备
```

AI 在回复中嵌入隐藏指令，服务端截取并转发，用户不可见：
```
[TOY:{"speed":0.5}]              强度 50%，持续
[TOY:{"speed":0.8,"sec":20}]     强度 80%，20 秒后自动停
[TOY:{"pattern":3,"level":0.7}]  振动花样3（仅震动棒）
[TOY:{"stop":true}]              立即停止
```

---

## 第三部分：两种连接方式

### 方式 A：安卓手机网页中继（推荐）

利用 Web Bluetooth API，手机浏览器直接连蓝牙。

**优点**：不需要开电脑，手机放在设备旁（< 1m），稳定。  
**限制**：需要安卓手机 + Chrome / Edge（iOS 不支持）。

**一次性准备**：
1. 手机插充电器
2. 「开发者选项 → 充电时保持唤醒状态」打开
3. 息屏时间调最长

**每次使用**：
1. 开设备
2. 手机 Chrome 打开中继页面
3. 点「连接」，选 SL278H，看到「✅ 就绪」
4. 手机放在设备旁，屏幕保持亮着

> ⚠️ 切换 App 或锁屏会导致蓝牙断开。

---

### 方式 B：Windows 电脑 Python 中继

**优点**：不需要额外手机。  
**限制**：电脑需在附近（BLE 约 3-4m），使用前关手机蓝牙。

**安装**：
```bash
pip install bleak requests
```

**启动脚本** `start.bat`：
```bat
@echo off
set BRIDGE_URL=https://your-railway-server.up.railway.app
set BRIDGE_SECRET=your_secret
python bridge.py
pause
```

---

## 第四部分：设备能力
仅限博主的这款司沃康，分欣plus！具体姐妹们自己测试自己的玩具型号

| 设备 | CMD_SCALE（强度） | CMD_VIBRATE（花样） |
|------|-----------------|-------------------|
| 吮吸款 | 震动强度 0-100% | 不响应 |
| 震动棒 | 伸缩速度 0-100% | 8 档振动花样 |
| 两个都开 | 两个同时响应 | 仅震动棒加花样 |

---

## 第五部分：踩坑记录

| 坑 | 现象 | 原因 | 解决 |
|----|------|------|------|
| 写入通道错误 | 无响应 | 命令发到 AE01（OTA 口） | 改用 FFE1 |
| BLE 库编译失败 | C++ 报错 | Node 24 不兼容 | 改用 Python + bleak |
| WebSocket 断连 | fragmented control frame | Railway 代理不支持 WS 分帧 | 改用 HTTP 轮询 |
| 发一次就停 | 动一下就停 | 设备超时保护 | 每 1.5s 续命重发 |
| BLE 地址变化 | 重启后连不上 | MAC 随机旋转 | 按名字扫描 |
| 蓝牙距离短 | 3-4m 就断 | BLE 距离限制 | 手机放旁边做中继 |
| 手机息屏断开 | 屏幕黑后停止 | 浏览器被挂起 | Wake Lock + 充电保持唤醒 |

---

## ⚠️ 安全说明

`AE00/AE01` 是固件 OTA 升级通道，写入任何数据都可能导致设备永久变砖。  
控制通道固定为 `FFE0` 服务下的 `FFE1` 特征（write-without-response）。

---

---

## 第六部分：常见问题 & 不同情况适配

### Q1：我的玩具不是两件套，只有一个怎么办？

完全没问题，单个设备用法一样：
- 只有吮吸款：`speed` 控制震动强度，`pattern` 无效
- 只有震动棒：`speed` 控制伸缩速度，`pattern` 控制振动花样

### Q2：我有两个设备但它们名字/地址不一样？

部分型号两件设备**各自有独立蓝牙地址和名字**，不共用 MAC。这种情况：
- 用 `scanall.py` 列出所有附近的设备名和地址
- 两个设备可以**分别连接、独立控制**
- 修改 `bridge.py` 里的扫描逻辑，按具体名字区分

判断方法：两个设备都开机，用 nRF Connect 扫描，如果看到**两个不同条目**，说明地址独立；如果只看到一个，说明共用地址（像我们的情况）。

### Q3：扫描到了设备但连接失败？

常见原因：
- 设备已被手机 App 或另一台电脑占用 → 关掉其他连接再试
- 设备没电 → 充电后重试
- 距离太远 → 靠近后重试
- Windows 蓝牙驱动问题 → 设备管理器里禁用再启用蓝牙适配器

### Q4：命令发出去了但设备没反应？

按顺序排查：
1. `scan.py` 确认 FFE1 特征存在
2. nRF Connect 手动写 `55 04 00 00 01 B4 AA` 验证通道
3. 确认没有写到 AE01（OTA 口）
4. 换一个 USB 蓝牙适配器试试（内置蓝牙有时不稳定）

### Q5：电脑和手机都想用，怎么切换？

先停掉电脑的 bridge.py（关闭黑色窗口）
再用手机网页连接（反之亦然）
两个中继不能同时运行，否则会抢占设备连接

### Q6：设备连上了但过一会儿自动断开？

电脑：检查系统蓝牙省电设置，关闭「允许计算机关闭此设备以节约电源」
手机：确认屏幕常亮，不要切换 App
通用：玩具本身没电也会断开，注意充电

### Q7：能同时控制两个独立地址的设备吗？
可以，修改 bridge.py 启动两个 BleakClient 并行连接，各自维护一个写入句柄，收到指令后同时发送给两个设备。需要一定 Python 基础，可以参考 bridge.py 里的 ble_loop 逻辑自行扩展。

---

### 平台适配

### Windows（推荐）
pip install bleak requests
python bridge.py
要求：Windows 10 1903+ / Windows 11，内置蓝牙或 USB 蓝牙适配器。
如果 bleak 安装失败：确认 Python 已加入 PATH，用管理员权限运行命令提示符。

### macOS
pip3 install bleak requests
python3 bridge.py
要求：macOS 10.15+，首次运行会弹窗请求蓝牙权限，点「允许」。
注意：部分 M 系列 Mac 需要在「系统设置 → 隐私与安全 → 蓝牙」里手动允许终端。

### Linux
pip3 install bleak requests
# 需要 BlueZ 5.43+
sudo python3 bridge.py

### Ubuntu / Debian 安装 BlueZ：
sudo apt install bluetooth bluez
sudo systemctl start bluetooth

### 部分发行版需要 sudo 才能访问蓝牙，或者把用户加入 bluetooth 组：
sudo usermod -a -G bluetooth $USER

### 安卓（网页中继，无需电脑）
支持：Chrome 56+ / Edge（基于 Chromium）
不支持：Firefox、微信内置浏览器、QQ浏览器

步骤：
打开 Chrome，访问中继页面
点「连接」，弹窗选择 SL278H
插上充电器 + 开启「充电时保持唤醒」防息屏
如果弹窗里找不到设备：确认设备已开机，手机蓝牙已打开，距离在 1 米内。

### iOS / iPhone
Web Bluetooth API 在 iOS Safari 上不受支持，目前无法用网页中继方案。

可选替代：
借一台安卓手机做中继
用 Windows / Mac / Linux 电脑运行 bridge.py
等待 Apple 在未来版本支持 Web Bluetooth（目前无时间表）

---

## 第七部分：用 Claude.ai 直接控制（MCP 接入）

不需要搭建自己的 PWA，只需要 Claude.ai 账号 + Railway 部署，就能让 AI 控制玩具。

### 原理

Railway 上运行一个 MCP Server，Claude.ai 通过 Integrations 连接它，聊天时 Claude 可以直接调用：
- `toy_set_speed` — 设置强度
- `toy_set_pattern` — 设置震动花样
- `toy_stop` — 停止
- `toy_status` — 查询是否在线

### 步骤

**第一步：部署 Railway bridge**

1. Fork 本仓库（或单独建一个，把 `bridge/index.js` 放进去）
2. 在 [railway.app](https://railway.app) 新建项目 → Deploy from GitHub
3. 设置环境变量：

| 变量 | 说明 |
|------|------|
| `BRIDGE_SECRET` | 自己设一个密码，例如 `mysecret123` |
| `PORT` | Railway 自动填，不用管 |

4. 部署成功后记下你的 Railway 地址，例如：`https://xxx.up.railway.app`

**第二步：启动蓝牙中继**

选一种：
- **安卓手机**：Chrome 打开 `https://xxx.up.railway.app`（需要在 toy.html 里把地址改成你自己的 Railway）
- **电脑**：设置环境变量后运行 `python bridge.py`

set BRIDGE_URL=https://xxx.up.railway.app
set BRIDGE_SECRET=mysecret123
python bridge.py

**第三步：Claude.ai 添加 MCP Integration**

打开 claude.ai → Settings → Integrations
点 Add Integration
填入：
URL：https://xxx.up.railway.app/mcp?secret=mysecret123
保存

**第四步：开始使用**

新建对话，告诉 Claude：

「帮我控制玩具，先查一下是否在线，然后设置强度 50%」

Claude 会自动调用 MCP tool 完成操作。


---

## 补充一：致谢与参考资料

本项目的协议逆向参考了社区前人的工作：
- **吱吱 & Veille** 的 SVAKOM BLE 逆向记录，确认了 FFE0/FFE1 控制通道和 AE00/AE01 OTA 通道的区别
- nRF Connect 社区的 BLE 抓包分析方法

在他们的基础上，我们补充了：续命机制的发现和验证、双设备联动逻辑、以及完整的 AI 控制系统架构。

---

## 补充二：APK 获取方法

jadx 逆向的前提是拿到 APK 文件，几种方法：

**方法一：从自己手机导出（最安全）**
1. 手机安装 SVAKOM 官方 App
2. 用「MT管理器」或「ES文件浏览器」找到 App 的 APK 路径（通常在 `/data/app/` 下）
3. 复制到电脑

**方法二：APKPure / APKMirror**
直接搜索「SVAKOM」下载，选和手机 App 相同的版本号。

**注意**：下载来源要可信，不要用来路不明的 APK 安装到手机上，这里只用于反编译分析，不安装。

---

## 补充三：jadx 里具体怎么找命令定义

打开 APK 之后，不是随便翻，按这个顺序找：

1. 左边包结构里找 `com.svakom` 开头的包
2. 搜索（Ctrl+F）关键词：`PROTOCOL_HEADER` 或 `0x55` 或 `CMD_`
3. 找到后看同一个类里还有哪些常量——`CMD_SCALE`、`CMD_VIBRATE` 通常在同一个类里
4. 看发送命令的方法，找类似 `sendCommand(byte[] data)` 的函数
5. 追踪这个函数在哪里被调用，参数怎么构造——这就是完整的命令格式

**tail 字节怎么确定的（0xAA vs 0x00）：**
从 APK 里构造命令的代码直接读出来的。强度命令（CMD_SCALE）的构造代码最后一个字节写的是 `0xAA`，振动花样（CMD_VIBRATE）写的是 `0x00`。不同命令的 tail 可能不同，要逐一确认，不能统一用一个。

---

## 补充四：适配其他 SVAKOM 型号 / 其他品牌

**如果你的设备不是 SL278H：**

1. `bridge.py` 和 `scan.py` 里改扫描名字：
```python
# 把这行
dev = next((d for d in devs if d.name and "SL278" in d.name), None)
# 改成你的设备名（nRF Connect 扫描到的名字）
dev = next((d for d in devs if d.name and "你的设备名" in d.name), None)
用 scan.py 扫出你的设备的服务和特征，找到 write-without-response 的特征 UUID，替换 WRITE_UUID
用 nRF Connect 手动发命令验证，再跑 test.py
如果是完全不同品牌：

协议格式可能完全不同，需要重新从 APK 逆向。但方法论一样：jadx 找命令构造 → nRF Connect 验证 → 脚本批量测试。

补充五：Railway 完整部署教程
第一步：准备代码

Fork 本仓库，或者新建一个仓库，至少包含：

bridge/index.js（主服务器）
package.json（填入依赖）
package.json 内容：

{
  "name": "svakom-bridge",
  "type": "module",
  "scripts": { "start": "node bridge/index.js" },
  "dependencies": {
    "express": "^4.18.0",
    "ws": "^8.0.0"
  }
}
第二步：Railway 部署

注册 railway.app（GitHub 账号登录）
New Project → Deploy from GitHub Repo → 选你的仓库
Railway 会自动检测 package.json 并部署
第三步：设置环境变量

Railway 项目 → Variables → 添加：

变量名	值	说明
BRIDGE_SECRET	自己设，如 abc123xyz	保护接口不被乱调用
第四步：拿到你的 Railway 地址

部署成功后，Settings → Networking → Public Domain，格式类似：
https://svakom-bridge-production.up.railway.app

这就是你的 BRIDGE_URL。

补充六：bridge.py 指向自己的 Railway
有两种方式传入地址：

方式一：环境变量（推荐）

# Windows
set BRIDGE_URL=https://你的railway地址.up.railway.app
set BRIDGE_SECRET=你设的密码
python bridge.py

# Mac / Linux
export BRIDGE_URL=https://你的railway地址.up.railway.app
export BRIDGE_SECRET=你设的密码
python3 bridge.py
方式二：直接改代码

打开 bridge.py，找到这行：

BRIDGE_URL = os.environ.get("BRIDGE_URL", "").rstrip("/")
改成：

BRIDGE_URL = "https://你的railway地址.up.railway.app"
补充七：toy.html 指向自己的 Railway
toy.html 里有一个中继地址输入框，默认值是原作者的地址。

打开 toy.html，找到这行：

<input id="relay" value="/api/toy-relay" />
方法一：页面上直接改（最简单）
打开网页后，直接在「中继地址」输入框里把地址改成：

https://你的railway地址.up.railway.app/toy-next
然后点连接，不需要改代码。

方法二：改默认值
下载 toy.html，把 value="/api/toy-relay" 改成你的 Railway 地址，保存后用浏览器直接打开（不需要服务器）。

补充八：怎么跟 AI 说话才会触发玩具控制
使用 Claude.ai + MCP 方案时：

添加 MCP Integration 后，新建对话，开头告诉 Claude：

我有一个 SVAKOM 振动玩具通过蓝牙连接到了 MCP 工具里。
你可以用 toy_set_speed、toy_set_pattern、toy_stop 来控制它。
先用 toy_status 确认是否在线，然后我们开始。
之后正常聊天，你可以直接说：

「开到50%」
「换个花样试试」
「停一下」
Claude 会自己判断什么时候调用工具。

使用自己搭的 PWA 方案时：

系统会自动告知 AI 玩具已连接，不需要额外提示。开始时只需要告诉 AI 开了哪个设备：

「只开了吮吸款」
「两个都开了」
补充九：BLE 距离的实测方法
理论上 BLE 有效距离是 10 米，但实际受墙壁、干扰影响很大。

自测方法：

运行 bridge.py，连上设备后保持续命
手持电脑（或手机）慢慢远离设备
观察黑色窗口——出现「写入失败」或续命报错就是超距了
记下大概距离
我们实测结论：同一房间内无遮挡约 3-4 米开始不稳定，有墙壁更短。所以推荐手机放床边做中继，距离控制在 1 米内。

最后更新：2026-06-15
