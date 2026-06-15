# svakom-ble-ai
SVAKOM SL278H 蓝牙协议逆向 + AI 远程控制系统
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

**强度控制**（两个设备都响应）：
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

---

### 平台适配

### Windows（推荐）
```bash
pip install bleak requests
python bridge.py
要求：Windows 10 1903+ / Windows 11，内置蓝牙或 USB 蓝牙适配器。
如果 bleak 安装失败：确认 Python 已加入 PATH，用管理员权限运行命令提示符。

macOS
pip3 install bleak requests
python3 bridge.py
要求：macOS 10.15+，首次运行会弹窗请求蓝牙权限，点「允许」。
注意：部分 M 系列 Mac 需要在「系统设置 → 隐私与安全 → 蓝牙」里手动允许终端。

Linux
pip3 install bleak requests
# 需要 BlueZ 5.43+
sudo python3 bridge.py

Ubuntu / Debian 安装 BlueZ：
sudo apt install bluetooth bluez
sudo systemctl start bluetooth

部分发行版需要 sudo 才能访问蓝牙，或者把用户加入 bluetooth 组：
sudo usermod -a -G bluetooth $USER

安卓（网页中继，无需电脑）
支持：Chrome 56+ / Edge（基于 Chromium）
不支持：Firefox、微信内置浏览器、QQ浏览器

步骤：

打开 Chrome，访问中继页面
点「连接」，弹窗选择 SL278H
插上充电器 + 开启「充电时保持唤醒」防息屏
如果弹窗里找不到设备：确认设备已开机，手机蓝牙已打开，距离在 1 米内。

iOS / iPhone
Web Bluetooth API 在 iOS Safari 上不受支持，目前无法用网页中继方案。

可选替代：

借一台安卓手机做中继
用 Windows / Mac / Linux 电脑运行 bridge.py
等待 Apple 在未来版本支持 Web Bluetooth（目前无时间表）
Q5：电脑和手机都想用，怎么切换？
先停掉电脑的 bridge.py（关闭黑色窗口）
再用手机网页连接（反之亦然）
两个中继不能同时运行，否则会抢占设备连接
Q6：设备连上了但过一会儿自动断开？
电脑：检查系统蓝牙省电设置，关闭「允许计算机关闭此设备以节约电源」
手机：确认屏幕常亮，不要切换 App
通用：玩具本身没电也会断开，注意充电
Q7：能同时控制两个独立地址的设备吗？
可以，修改 bridge.py 启动两个 BleakClient 并行连接，各自维护一个写入句柄，收到指令后同时发送给两个设备。需要一定 Python 基础，可以参考 bridge.py 里的 ble_loop 逻辑自行扩展。

---

*最后更新：2026-06-15*
