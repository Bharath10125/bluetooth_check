# Embedded Bluetooth & OTA Firmware Suite

A collection of embedded microcontroller projects for **Bluetooth Low Energy (BLE)**, **Classic Bluetooth (SPP)**, and **Over-The-Air (OTA)** firmware updates targeting ESP32-C3 and Arduino (ATmega328P) platforms, complete with Python host testing and flashing utilities.

---

## 📂 Repository Structure

```text
.
├── bluetooth_esp_mini_c3/   # ESP32-C3 BLE Stepper Motor Controller (Arduino + NimBLE)
├── bluetooth_nano/          # Arduino Nano + HC-05 Classic Bluetooth Serial Bridge
├── ota_ble_esp32c3/         # ESP32-C3 BLE Over-The-Air (OTA) DFU (ESP-IDF + NimBLE)
│   └── ble_ota.py           # Python host script for flashing firmware over BLE
├── ota_esp32c3/             # ESP32-C3 Wi-Fi ArduinoOTA Firmware (Arduino)
├── test_bleak.py            # Python script to scan and test BLE notification stream
└── README.md                # Project documentation
```

---

## 🛠️ Projects Overview

| Directory | Target Hardware | Framework | Protocol | Description |
| :--- | :--- | :--- | :--- | :--- |
| **[`ota_ble_esp32c3`](./ota_ble_esp32c3/)** | Seeed Studio XIAO ESP32-C3 | ESP-IDF | BLE (GATT) | Dual-partition BLE OTA firmware updater with Python host client |
| **[`bluetooth_esp_mini_c3`](./bluetooth_esp_mini_c3/)** | ESP32-C3 DevKitM-1 | Arduino | BLE (GATT) | Remote 4-wire stepper motor controller over BLE via NimBLE |
| **[`bluetooth_nano`](./bluetooth_nano/)** | Arduino Nano (ATmega328P) | Arduino | Classic BT (SPP) | SoftwareSerial bridge with HC-05 module for UART communication |
| **[`ota_esp32c3`](./ota_esp32c3/)** | Seeed Studio XIAO ESP32-C3 | Arduino | Wi-Fi (ESP-OTA) | Wireless firmware updates over local Wi-Fi using `ArduinoOTA` |
| **[`test_bleak.py`](./test_bleak.py)** | Host PC (Linux/macOS/Win) | Python 3 | BLE Client | Standalone Bleak client to test BLE connection and notifications |

---

## 1. `ota_ble_esp32c3` — ESP32-C3 BLE Over-The-Air (OTA) DFU

This project implements a wireless Over-The-Air (OTA) firmware upgrade mechanism entirely over Bluetooth Low Energy (BLE) using **ESP-IDF** and the **Apache NimBLE** stack on the Seeed Studio XIAO ESP32-C3.

### Key Features
- **Dual OTA Partition Scheme**: Automatically flips between `app0` (`ota_0`) and `app1` (`ota_1`) partitions upon validation.
- **Fail-Safe & Abort Protection**: If the connection drops during transmission, the OTA session aborts cleanly without corrupting the active partition.
- **State Separation**: Automatically disables normal telemetry/application tasks during OTA mode to dedicate BLE bandwidth to firmware transfer.
- **Python Flashing Client**: Included `ble_ota.py` tool chunks and transmits `.bin` firmware with real-time progress and verification.

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
| **CONTROL** | `21222324-2526-2728-292a-2b2c2d2e2f30` | `WRITE` | Control commands: `START` (enter OTA) or `END` (validate & reboot) |
| **DATA** | `31323334-3536-3738-393a-3b3c3d3e3f40` | `WRITE` | Chunked binary firmware payload (180 bytes per chunk) |
| **STATUS** | `41424344-4546-4748-494a-4b4c4d4e4f50` | `NOTIFY` | OTA status notifications (`READY`, `SUCCESS`, or `ERROR:...`) |

### Building and Uploading via BLE
1. **Compile the firmware**:
   ```bash
   cd ota_ble_esp32c3
   pio run
   ```
2. **Flash the initial binary via USB**:
   ```bash
   pio run -t upload
   ```
3. **Subsequent wireless OTA updates**:
   ```bash
   python3 ble_ota.py
   ```

---

## 2. `bluetooth_esp_mini_c3` — ESP32-C3 BLE Stepper Motor Controller

A BLE peripheral application designed for the **ESP32-C3 DevKitM-1** using the **Arduino** framework and **`NimBLE-Arduino`** library. It controls a 4-wire stepper motor (such as 28BYJ-48 driven by ULN2003) via wireless BLE commands.

### Pinout & Wiring
| Component Pin | ESP32-C3 GPIO | Function |
| :--- | :--- | :--- |
| **Driver IN1** | `GPIO 4` | Stepper Coil 1 |
| **Driver IN2** | `GPIO 5` | Stepper Coil 2 |
| **Driver IN3** | `GPIO 6` | Stepper Coil 3 |
| **Driver IN4** | `GPIO 7` | Stepper Coil 4 |
| **Status LED** | `GPIO 8` | High when motor is running, Low when stopped |

### BLE Interface
- **Advertised Device Name**: `ESP32-C3-Stepper`
- **Service UUID**: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- **Characteristic UUID**: `beb5483e-36e1-4688-b7f5-ea07361b26a8` (`READ`, `WRITE`, `NOTIFY`)

### Supported BLE Commands
| Command | Behavior | Notification Response |
| :--- | :--- | :--- |
| `START` | Starts 8-step half-step sequence; turns LED on | `MOTOR STARTED` |
| `STOP` | De-energizes all coils to prevent heating; turns LED off | `MOTOR STOPPED` |
| `PING` | Connection health check | `PONG` |
| *Other* | Unrecognized command | `UNKNOWN COMMAND` |

### Building and Flashing
```bash
cd bluetooth_esp_mini_c3
pio run -t upload
```

---

## 3. `bluetooth_nano` — Arduino Nano & HC-05 Classic Bluetooth

An **ATmega328P (Arduino Nano)** project interfacing with an **HC-05** Classic Bluetooth Serial Port Profile (SPP) module using `SoftwareSerial`.

### Hardware Wiring
| HC-05 Pin | Arduino Nano Pin | Notes |
| :--- | :--- | :--- |
| **TX** | `Pin 10` (RX) | Direct connection |
| **RX** | `Pin 11` (TX) | Recommended: 1kΩ/2kΩ voltage divider to 3.3V |
| **VCC** | `5V` | Module power |
| **GND** | `GND` | Common ground |

### Operation
- **Baud Rate**: `9600` baud on both Hardware Serial (`Serial`) and SoftwareSerial (`bluetooth`).
- **Functionality**:
  - Forwards received Bluetooth strings to the USB Serial Monitor.
  - When the string `PING` is received over Bluetooth, replies with `PONG`.

### Building and Flashing
```bash
cd bluetooth_nano
pio run -t upload
```

---

## 4. `ota_esp32c3` — ESP32-C3 Wi-Fi ArduinoOTA

An **Arduino**-based wireless update solution for the **Seeed Studio XIAO ESP32-C3** utilizing `WiFi.h` and `ArduinoOTA`.

### Configuration
- **Wi-Fi Target**: Pre-configured in `src/wifi.cpp` to connect to the designated local wireless network.
- **Hostname**: `xiao-c3`
- **Upload Protocol**: Configured in `platformio.ini` via `upload_protocol = espota` targeting `upload_port = 192.168.0.6`.

### Building and Flashing
- **First-time USB Flash**:
  Edit `platformio.ini` to comment out `upload_protocol` and `upload_port`, then run `pio run -t upload`.
- **Over-The-Air Wi-Fi Flash**:
  With `upload_protocol = espota` enabled:
  ```bash
  cd ota_esp32c3
  pio run -t upload
  ```

---

## 5. Host Test Scripts

### `test_bleak.py`
A standalone Python diagnostic utility built on top of `bleak`:
- Scans for the `XIAO-BLE-DFU` peripheral.
- Connects and subscribes to the `MESSAGE` characteristic (`11121314-1516-1718-191a-1b1c1d1e1f20`).
- Streams real-time notifications to the console to verify BLE radio health.

```bash
# Install dependencies
pip install bleak

# Run the monitor
python3 test_bleak.py
```

---

## 📋 Prerequisites & Tools

1. **[PlatformIO Core (CLI)](https://docs.platformio.org/en/latest/core/index.html)** or PlatformIO IDE extension in VS Code.
2. **Python 3.8+** with the following packages installed for host scripts:
   ```bash
   pip install bleak
   ```
3. Host system with Bluetooth 4.0+ hardware support.
