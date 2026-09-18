# ESP32-C3 Bluetooth & OTA Firmware Suite

A collection of embedded microcontroller projects for **Bluetooth Low Energy (BLE)**, **Over-The-Air (OTA)** wireless firmware updates, and **motor control** targeting ESP32-C3 platforms, accompanied by Python host utilities for wireless flashing and diagnostics.

---

## 📂 Repository Structure

```text
.
├── ble_ota.py                  # Python host script to wirelessly flash firmware to ESP32-C3 over BLE
├── bluetooth_esp32c3_ltaram/   # ESP32-C3 BLE Servo Motor Controller Project (Arduino + NimBLE)
├── ota_ble_esp32c3/            # ESP32-C3 BLE-Based Over-The-Air (OTA) Firmware Update (ESP-IDF + NimBLE)
├── ota_wifi_esp32c3/           # ESP32-C3 Wi-Fi Over-The-Air (OTA) Firmware Update (Arduino + ArduinoOTA)
├── test_bleak.py               # Python script to scan and test BLE notification stream
└── README.md                   # Project documentation
```

---

## 🛠️ Projects Overview

| Directory / Script | Target Hardware | Framework | Protocol | Description |
| :--- | :--- | :--- | :--- | :--- |
| **[`ota_ble_esp32c3`](./ota_ble_esp32c3/)** | Seeed Studio XIAO ESP32-C3 | ESP-IDF | BLE (GATT) | BLE-based firmware code update project with dual-partition fail-safe OTA |
| **[`ble_ota.py`](./ble_ota.py)** | Host PC (Linux/macOS/Win) | Python 3 (Bleak) | BLE (GATT) | Python script to wirelessly update firmware code to ESP32-C3 via BLE |
| **[`bluetooth_esp32c3_ltaram`](./bluetooth_esp32c3_ltaram/)** | ESP32-C3 DevKitM-1 | Arduino | BLE (GATT) | Servo / stepper motor control project operated wirelessly via BLE |
| **[`ota_wifi_esp32c3`](./ota_wifi_esp32c3/)** | Seeed Studio XIAO ESP32-C3 | Arduino | Wi-Fi (ESP-OTA) | Wireless firmware update project over local Wi-Fi using `ArduinoOTA` |
| **[`test_bleak.py`](./test_bleak.py)** | Host PC (Linux/macOS/Win) | Python 3 (Bleak) | BLE Client | Standalone Bleak client to test BLE connectivity and notification streams |

---

## 1. `ota_ble_esp32c3` — BLE-Based Firmware Code Update

This project implements wireless Over-The-Air (OTA) firmware code updates over **Bluetooth Low Energy (BLE)** using **ESP-IDF** and the **Apache NimBLE** stack on the Seeed Studio XIAO ESP32-C3.

### Key Features
- **Dual OTA Partition Scheme**: Automatically alternates between `app0` (`ota_0`) and `app1` (`ota_1`) slots upon image verification.
- **Fail-Safe & Abort Protection**: If the BLE connection drops during transmission, the OTA session aborts cleanly without corrupting the active partition.
- **Dedicated OTA Bandwidth**: Telemetry tasks are suspended during OTA transfer to allocate full BLE throughput to firmware data.
- **Direct BLE Flashing**: Pairs directly with `ble_ota.py` for wireless deployment.

### Partition Table (`partitions.csv`)
| Name | Type | SubType | Offset | Size | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `nvs` | data | nvs | `0x9000` | `0x5000` (20 KB) | Non-volatile storage |
| `otadata` | data | ota | `0xe000` | `0x2000` (8 KB) | OTA boot state selector |
| `app0` | app | ota_0 | `0x10000` | `0x180000` (1.5 MB) | Primary application slot |
| `app1` | app | ota_1 | `0x190000` | `0x180000` (1.5 MB) | Secondary application slot |

### BLE GATT Profile
- **Advertised Device Name**: `XIAO-BLE-DFU`
- **Primary Service UUID**: `01020304-0506-0708-090a-0b0c0d0e0f10`

| Characteristic | UUID | Properties | Purpose |
| :--- | :--- | :--- | :--- |
| **MESSAGE** | `11121314-1516-1718-191a-1b1c1d1e1f20` | `NOTIFY` | Periodic heartbeat / application telemetry in normal mode |
| **CONTROL** | `21222324-2526-2728-292a-2b2c2d2e2f30` | `WRITE` | Control commands: `START` (enter OTA mode) or `END` (validate & reboot) |
| **DATA** | `31323334-3536-3738-393a-3b3c3d3e3f40` | `WRITE` | Chunked binary firmware payload (180 bytes per chunk) |
| **STATUS** | `41424344-4546-4748-494a-4b4c4d4e4f50` | `NOTIFY` | OTA status notifications (`READY`, `SUCCESS`, or `ERROR:...`) |

### Building and Initial Flashing
1. **Compile the firmware**:
   ```bash
   cd ota_ble_esp32c3
   pio run
   ```
2. **Flash the initial image via USB**:
   ```bash
   pio run -t upload
   ```

---

## 2. `ble_ota.py` — Wireless BLE Firmware Update Script

`ble_ota.py` is the host-side Python utility used to update the firmware code wirelessly to the ESP32-C3 over Bluetooth Low Energy. Once an initial BLE-OTA firmware is flashed to the device, all subsequent code updates can be transmitted wirelessly using this script without a USB cable.

### How It Works
1. **Scans**: Discovers the target device advertising as `XIAO-BLE-DFU`.
2. **Connects & Subscribes**: Subscribes to the `MESSAGE` and `STATUS` GATT characteristics.
3. **Initiates OTA**: Writes `START` to the `CONTROL` characteristic and waits for the `READY` notification.
4. **Streams Payload**: Reads the compiled `.bin` firmware file and streams chunks (180 bytes each) to the `DATA` characteristic with real-time transfer rate and progress reporting.
5. **Finalizes & Validates**: Writes `END` to `CONTROL` and listens for `SUCCESS`. The ESP32-C3 verifies the image partition and reboots into the new firmware.

### Flashing Firmware Wirelessly Over BLE
After compiling your updated code in `ota_ble_esp32c3`:
```bash
# Navigate to the ota_ble_esp32c3 directory where .pio build output is located:
cd ota_ble_esp32c3

# Run the update script to wirelessly flash the ESP32-C3:
python3 ../ble_ota.py
```

---

## 3. `bluetooth_esp32c3_ltaram` — ESP32-C3 Servo Motor Project

A wireless motor control project designed for the **ESP32-C3 DevKitM-1** utilizing the **Arduino** framework and the **`NimBLE-Arduino`** library. It controls motor / servo actuation through wireless BLE commands.

### Pinout & Wiring
| Component Pin | ESP32-C3 GPIO | Function |
| :--- | :--- | :--- |
| **Driver IN1** | `GPIO 4` | Motor Control Line 1 |
| **Driver IN2** | `GPIO 5` | Motor Control Line 2 |
| **Driver IN3** | `GPIO 6` | Motor Control Line 3 |
| **Driver IN4** | `GPIO 7` | Motor Control Line 4 |
| **Status LED** | `GPIO 8` | High when motor is running, Low when stopped |

### BLE Interface
- **Advertised Device Name**: `ESP32-C3-Stepper`
- **Service UUID**: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- **Characteristic UUID**: `beb5483e-36e1-4688-b7f5-ea07361b26a8` (`READ`, `WRITE`, `NOTIFY`)

### Supported BLE Commands
| Command | Behavior | Notification Response |
| :--- | :--- | :--- |
| `START` | Starts the motor actuation sequence; turns LED on | `MOTOR STARTED` |
| `STOP` | De-energizes all motor lines to prevent heating; turns LED off | `MOTOR STOPPED` |
| `PING` | Connection health check | `PONG` |
| *Other* | Unrecognized command | `UNKNOWN COMMAND` |

### Building and Flashing
```bash
cd bluetooth_esp32c3_ltaram
pio run -t upload
```

---

## 4. `ota_wifi_esp32c3` — ESP32-C3 Wi-Fi OTA Firmware Update

An **Arduino**-based project for the **Seeed Studio XIAO ESP32-C3** that enables wireless firmware updates over local Wi-Fi using `WiFi.h` and `ArduinoOTA`.

### Configuration
- **Wi-Fi Target**: Configured in `src/wifi.cpp` to join the local wireless network.
- **Hostname**: `xiao-c3`
- **Upload Protocol**: Configured in `platformio.ini` via:
  ```ini
  upload_protocol = espota
  upload_port = 192.168.0.6
  ```

### Building and Flashing
- **First-time USB Flash**:
  Temporarily comment out `upload_protocol` and `upload_port` in `platformio.ini`, then run:
  ```bash
  cd ota_wifi_esp32c3
  pio run -t upload
  ```
- **Wireless Wi-Fi OTA Update**:
  Ensure `upload_protocol = espota` and `upload_port` is set to the ESP32-C3 IP address, then run:
  ```bash
  cd ota_wifi_esp32c3
  pio run -t upload
  ```

---

## 5. Host Test Scripts

### `test_bleak.py`
A standalone Python diagnostic utility built on top of `bleak`:
- Scans for the `XIAO-BLE-DFU` peripheral.
- Connects and subscribes to the `MESSAGE` characteristic (`11121314-1516-1718-191a-1b1c1d1e1f20`).
- Streams real-time notifications to the terminal to verify BLE radio health.

```bash
# Run the monitor
python3 test_bleak.py
```

---

## 📋 Prerequisites & Tools

1. **[PlatformIO Core (CLI)](https://docs.platformio.org/en/latest/core/index.html)** or PlatformIO IDE extension in VS Code.
2. **Python 3.8+** with `bleak` installed:
   ```bash
   pip install bleak
   ```
3. Host system with Bluetooth 4.0+ hardware support.
