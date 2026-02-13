---
title: '"Tethering" Over ADB'
date: 2026-02-13
permalink: /posts/2026-02-13-adb-tethering
tags:
  - ADB
  - Network
  - socks5
---

This blog shows how to use Android ADB and SOCKS to serve "USB Tethering"

## Background

It all starts with my internet problem on campus. I noticed that our wifi connection only allows 20MHz for 5G wifi, which impacts both WiFi-5 and WiFi-6 devices. This policy locks the connection speed to 286Mbps. However, I found out they also enabled WiFi 6E 6GHz and it has a higher cap than 5GHz. If I need faster wifi, I have to get on 6GHz, but my MacBook Pro 2021 does not support 6GHz.

## The WiFi 6E Android Phone

Luckily I have an Android phone that supports WiFi 6E, but its USB tethering is locked to **RNDIS** by the manufacturer ROM. **RNDIS** is supported by Linux and Windows. It was supported on macOS through a third-party project [HoRNDIS](https://github.com/TomHeaven/HoRNDIS), but it is not usable on Apple Silicon MacBooks.

## ADB and SOCKS5

This leads us to a network workaround. Wired **ADB** provides a stable USB data channel, and a **SOCKS5** proxy running on the phone can redirect the Mac's traffic through the phone's 6GHz connection.

### Prerequisites

- [Termux](https://termux.dev) installed on the Android phone
- ADB installed on the Mac (`brew install android-platform-tools`)
- USB debugging enabled on the phone (Settings → Developer Options → USB Debugging)
- `microsocks` installed in Termux:
```bash
pkg install microsocks
```

### Step 1: Start the SOCKS5 Proxy on the phone

In Termux, start `microsocks` on port 1080:
```bash
microsocks -p 1080
```

To prevent Android from killing Termux when the screen locks:
- Settings → Apps → Termux → Battery → **Unrestricted**
- Pull down the Termux notification → tap **Acquire wakelock**

### Step 2: Forward the Port via ADB on the Mac

ADB forward maps a local Mac port to the port running on the phone over USB:
```bash
adb forward tcp:1080 tcp:1080
```

Since ADB forward can drop when the screen locks or USB is interrupted, use this loop to keep it alive:
```bash
while true; do
    adb forward tcp:1080 tcp:1080
    sleep 3
done
```

### Step 3: Configure the browser for isolated testc

In Firefox:
- Settings → search **proxy** → **Settings...**
- Select **Manual proxy configuration**
- SOCKS Host: `127.0.0.1`, Port: `1080`
- Select **SOCKS v5**
- Check **Proxy DNS when using SOCKS v5**
- Click OK

### Results

| | Download | Upload |
|---|---|---|
| Campus WiFi (5GHz) | 191 Mbps | 186 Mbps |
| This setup (6GHz via ADB) | 285 Mbps | 247 Mbps |

A ~50% improvement in download and ~33% in upload, all over a USB cable with no root or kernel extensions required.