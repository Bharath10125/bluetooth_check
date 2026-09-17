import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  BleManager,
  Device
} from "react-native-ble-plx";

import { Buffer } from "buffer";

// --------------------------------------------------
// BLE CONFIGURATION
// --------------------------------------------------

const SERVICE_UUID =
  "4fafc201-1fb5-459e-8fcc-c5c9c331914b";

const CHARACTERISTIC_UUID =
  "beb5483e-36e1-4688-b7f5-ea07361b26a8";

const DEVICE_NAME = "ESP32-C3-Stepper";

const CONNECT_TIMEOUT_MS = 15000;

// Commands the firmware understands
type Command = "START" | "STOP" | "PING";

// --------------------------------------------------
// BLE MANAGER
// --------------------------------------------------

const bleManager = new BleManager();

export default function HomeScreen() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [device, setDevice] = useState<Device | null>(null);

  const [lastMessage, setLastMessage] = useState("Waiting...");
  const [lastSent, setLastSent] = useState("-");

  const [motorRunning, setMotorRunning] = useState(false);
  const [sending, setSending] = useState(false);

  const [foundDevices, setFoundDevices] = useState<Device[]>([]);

  const deviceRef = useRef<Device | null>(null);

  // --------------------------------------------------
  // ANDROID BLE PERMISSIONS
  // --------------------------------------------------

  const requestBluetoothPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== "android") {
      return true;
    }

    try {
      if (Platform.Version >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        return (
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      }

      // Android 11 and below
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );

      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.error("BLE permission error:", error);

      Alert.alert(
        "Permission Error",
        "Bluetooth permissions could not be granted."
      );

      return false;
    }
  };

  // --------------------------------------------------
  // CHECK BLUETOOTH STATE
  // --------------------------------------------------

  const checkBluetoothState = async (): Promise<boolean> => {
    const state = await bleManager.state();

    console.log("Bluetooth state:", state);

    if (state !== "PoweredOn") {
      Alert.alert(
        "Bluetooth Disabled",
        "Please enable Bluetooth on your phone."
      );

      return false;
    }

    return true;
  };

  // --------------------------------------------------
  // SCAN FOR ESP32
  // --------------------------------------------------

  const scanForESP32 = async () => {
    if (scanning) {
      return;
    }

    try {
      const hasPermissions = await requestBluetoothPermissions();

      if (!hasPermissions) {
        return;
      }

      const bluetoothReady = await checkBluetoothState();

      if (!bluetoothReady) {
        return;
      }

      console.log("Starting BLE scan...");

      setScanning(true);
      setFoundDevices([]);

      bleManager.stopDeviceScan();

      bleManager.startDeviceScan(
        [SERVICE_UUID],
        {
          allowDuplicates: false,
        },
        (error, scannedDevice) => {
          if (error) {
            console.error("BLE scan error:", error);

            setScanning(false);

            Alert.alert(
              "BLE Scan Error",
              error.message || "Could not scan for BLE devices."
            );

            return;
          }

          if (!scannedDevice) {
            return;
          }

          console.log(
            "BLE device:",
            scannedDevice.name,
            scannedDevice.id
          );

          // Only accept our ESP32
          const matchesName =
            scannedDevice.name === DEVICE_NAME ||
            scannedDevice.localName === DEVICE_NAME;

          const matchesService =
            scannedDevice.serviceUUIDs?.some(
              (uuid) =>
                uuid.toLowerCase() === SERVICE_UUID.toLowerCase()
            );

          if (matchesName || matchesService) {
            console.log(
              "ESP32 FOUND:",
              scannedDevice.name,
              scannedDevice.id
            );

            setFoundDevices((current) => {
              const alreadyExists = current.some(
                (item) => item.id === scannedDevice.id
              );

              if (alreadyExists) {
                return current;
              }

              return [...current, scannedDevice];
            });
          }
        }
      );

      // Stop scan after 10 seconds
      setTimeout(() => {
        bleManager.stopDeviceScan();
        setScanning(false);

        console.log("BLE scan stopped");
      }, 10000);
    } catch (error) {
      console.error("Scan failed:", error);

      setScanning(false);

      Alert.alert(
        "BLE Error",
        "Could not start BLE scanning."
      );
    }
  };

  // --------------------------------------------------
  // CONNECT TO ESP32
  // --------------------------------------------------

  const connectToESP32 = async (selectedDevice: Device) => {
    if (connecting) {
      return;
    }

    try {
      setConnecting(true);

      bleManager.stopDeviceScan();
      setScanning(false);

      console.log(
        "Connecting to:",
        selectedDevice.name,
        selectedDevice.id
      );

      // ----------------------------------------------
      // CONNECT
      // ----------------------------------------------

      const connectPromise = bleManager.connectToDevice(
        selectedDevice.id,
        {
          timeout: CONNECT_TIMEOUT_MS,
        }
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Connection timed out"));
        }, CONNECT_TIMEOUT_MS);
      });

      const connectedDevice = await Promise.race([
        connectPromise,
        timeoutPromise,
      ]);

      console.log(
        "BLE connected:",
        connectedDevice.name,
        connectedDevice.id
      );

      // ----------------------------------------------
      // DISCOVER SERVICES + CHARACTERISTICS
      // ----------------------------------------------

      const discoveredDevice =
        await connectedDevice.discoverAllServicesAndCharacteristics();

      console.log("BLE services discovered");

      // ----------------------------------------------
      // VERIFY OUR CHARACTERISTIC
      // ----------------------------------------------

      const services = await discoveredDevice.services();

      const service = services.find(
        (item) =>
          item.uuid.toLowerCase() === SERVICE_UUID.toLowerCase()
      );

      if (!service) {
        throw new Error(
          "ESP32 service was not found."
        );
      }

      const characteristics =
        await service.characteristics();

      const characteristic = characteristics.find(
        (item) =>
          item.uuid.toLowerCase() ===
          CHARACTERISTIC_UUID.toLowerCase()
      );

      if (!characteristic) {
        throw new Error(
          "ESP32 characteristic was not found."
        );
      }

      console.log(
        "BLE characteristic found:",
        characteristic.uuid
      );

      // ----------------------------------------------
      // SAVE CONNECTION
      // ----------------------------------------------

      setDevice(discoveredDevice);

      deviceRef.current = discoveredDevice;

      setConnected(true);

      setLastMessage("Connected");
      setLastSent("-");
      setMotorRunning(false);

      // ----------------------------------------------
      // LISTEN FOR ESP32 NOTIFICATIONS
      // ----------------------------------------------

      if (characteristic.isNotifiable) {
        console.log("Starting BLE notification listener...");

        discoveredDevice.monitorCharacteristicForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          (error, updatedCharacteristic) => {
            if (error) {
              console.error(
                "BLE notification error:",
                error
              );

              return;
            }

            if (!updatedCharacteristic?.value) {
              return;
            }

            try {
              const message = Buffer.from(
                updatedCharacteristic.value,
                "base64"
              ).toString("utf8");

              console.log("BLE RX:", message);

              const cleanMessage = message.trim();

              if (!cleanMessage) {
                return;
              }

              setLastMessage(cleanMessage);

              // Motor state comes from the ESP32, not the button press
              const upper = cleanMessage.toUpperCase();

              if (upper === "MOTOR STARTED") {
                setMotorRunning(true);
              } else if (upper === "MOTOR STOPPED") {
                setMotorRunning(false);
              }
            } catch (error) {
              console.error(
                "Failed to decode BLE data:",
                error
              );
            }
          }
        );
      }

      Alert.alert(
        "Connected",
        `${DEVICE_NAME}\n${discoveredDevice.id}`
      );
    } catch (error) {
      console.error(
        "ESP32 BLE connection failed:",
        error
      );

      setConnected(false);
      setDevice(null);
      setMotorRunning(false);
      deviceRef.current = null;

      const message =
        error instanceof Error
          ? error.message
          : "Could not connect to ESP32.";

      Alert.alert(
        "Connection Failed",
        message
      );
    } finally {
      setConnecting(false);
    }
  };

  // --------------------------------------------------
  // DISCONNECT
  // --------------------------------------------------

  const disconnectBluetooth = async () => {
    try {
      bleManager.stopDeviceScan();

      if (deviceRef.current) {
        // Leave the motor in a safe state before dropping the link
        try {
          await deviceRef.current.writeCharacteristicWithResponseForService(
            SERVICE_UUID,
            CHARACTERISTIC_UUID,
            Buffer.from("STOP").toString("base64")
          );
        } catch (error) {
          console.warn("Could not send STOP before disconnect:", error);
        }

        await bleManager.cancelDeviceConnection(
          deviceRef.current.id
        );
      }

      setConnected(false);
      setDevice(null);
      setMotorRunning(false);

      deviceRef.current = null;

      setLastMessage("Disconnected");

      console.log("BLE disconnected");
    } catch (error) {
      console.error(
        "BLE disconnect error:",
        error
      );

      setConnected(false);
      setDevice(null);
      setMotorRunning(false);

      deviceRef.current = null;
    }
  };

  // --------------------------------------------------
  // SEND COMMAND (START / STOP / PING)
  // --------------------------------------------------

  const sendCommand = async (command: Command) => {
    if (!connected || !device) {
      Alert.alert(
        "Not Connected",
        "Connect to ESP32 first."
      );

      return;
    }

    if (sending) {
      return;
    }

    try {
      setSending(true);

      console.log("BLE TX:", command);

      // Convert ASCII -> Base64
      const data = Buffer.from(command).toString("base64");

      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        data
      );

      setLastSent(command);
    } catch (error) {
      console.error(`${command} failed:`, error);

      Alert.alert(
        "BLE Error",
        `Could not send ${command}. Check the connection and try again.`
      );
    } finally {
      setSending(false);
    }
  };

  // --------------------------------------------------
  // CLEANUP
  // --------------------------------------------------

  useEffect(() => {
    return () => {
      bleManager.stopDeviceScan();

      if (deviceRef.current) {
        bleManager
          .cancelDeviceConnection(
            deviceRef.current.id
          )
          .catch((error) =>
            console.error(
              "Cleanup disconnect error:",
              error
            )
          );
      }
    };
  }, []);

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  const controlsDisabled = !connected || sending;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* HEADER */}

        <View style={styles.header}>
          <Text style={styles.title}>
            ESP32 BLE Control
          </Text>

          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusDot,
                connected
                  ? styles.connected
                  : styles.disconnected,
              ]}
            />

            <Text style={styles.statusText}>
              {connected
                ? "Connected"
                : "Disconnected"}
            </Text>
          </View>
        </View>

        {/* BLE DEVICE CARD */}

        <View style={styles.card}>

          <Text style={styles.cardTitle}>
            ESP32-C3
          </Text>

          <Text style={styles.deviceText}>
            {device
              ? device.name ||
                DEVICE_NAME
              : DEVICE_NAME}
          </Text>

          {device && (
            <Text style={styles.address}>
              BLE ID: {device.id}
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.connectButton,
              connected &&
                styles.disconnectButton,
            ]}
            onPress={
              connected
                ? disconnectBluetooth
                : scanForESP32
            }
            disabled={
              connecting ||
              scanning
            }
          >

            {connecting ||
            scanning ? (
              <View style={styles.loadingContainer}>

                <ActivityIndicator
                  color="#FFFFFF"
                />

                <Text
                  style={[
                    styles.buttonText,
                    styles.loadingText,
                  ]}
                >
                  {connecting
                    ? "Connecting..."
                    : "Scanning..."}
                </Text>

              </View>
            ) : (
              <Text style={styles.buttonText}>
                {connected
                  ? "Disconnect"
                  : "Scan for ESP32"}
              </Text>
            )}

          </TouchableOpacity>
        </View>

        {/* FOUND DEVICES */}

        {foundDevices.length > 0 && (
          <View style={styles.card}>

            <Text style={styles.cardTitle}>
              BLE Devices Found
            </Text>

            {foundDevices.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.deviceRow}
                onPress={() =>
                  connectToESP32(item)
                }
                disabled={connecting}
              >

                <View style={styles.deviceInfo}>

                  <Text style={styles.deviceName}>
                    {item.name ||
                      item.localName ||
                      "Unknown BLE Device"}
                  </Text>

                  <Text
                    style={styles.deviceAddress}
                  >
                    {item.id}
                  </Text>

                </View>

                <Text style={styles.paired}>
                  CONNECT
                </Text>

              </TouchableOpacity>
            ))}

          </View>
        )}

        {/* MOTOR CARD */}

        <View style={styles.motorCard}>

          <Text style={styles.cardTitle}>
            Stepper Motor
          </Text>

          <View style={styles.motorStateRow}>
            <View
              style={[
                styles.statusDot,
                motorRunning
                  ? styles.running
                  : styles.stopped,
              ]}
            />

            <Text style={styles.motorStateText}>
              {motorRunning ? "Running" : "Stopped"}
            </Text>
          </View>

          <View style={styles.controlRow}>

            <TouchableOpacity
              style={[
                styles.controlButton,
                styles.startButton,
                (controlsDisabled || motorRunning) &&
                  styles.disabledButton,
              ]}
              onPress={() => sendCommand("START")}
              disabled={controlsDisabled || motorRunning}
            >
              <Text style={styles.controlButtonText}>
                Start motor
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.controlButton,
                styles.stopButton,
                (controlsDisabled || !motorRunning) &&
                  styles.disabledButton,
              ]}
              onPress={() => sendCommand("STOP")}
              disabled={controlsDisabled || !motorRunning}
            >
              <Text style={styles.controlButtonText}>
                Stop motor
              </Text>
            </TouchableOpacity>

          </View>

          <Text style={styles.hint}>
            {connected
              ? "State updates when the ESP32 confirms the command."
              : "Connect to the ESP32 to control the motor."}
          </Text>

        </View>

        {/* PING CARD */}

        <View style={styles.pingCard}>

          <Text style={styles.cardTitle}>
            BLE Ping Pong
          </Text>

          <Text style={styles.messageLabel}>
            Last Message
          </Text>

          <Text style={styles.message}>
            {lastMessage}
          </Text>

          <TouchableOpacity
            style={[
              styles.pingButton,
              controlsDisabled &&
                styles.disabledButton,
            ]}
            onPress={() => sendCommand("PING")}
            disabled={controlsDisabled}
          >
            <Text style={styles.pingButtonText}>
              PING
            </Text>
          </TouchableOpacity>

        </View>

        {/* COMMUNICATION LOG */}

        <View style={styles.logCard}>

          <Text style={styles.cardTitle}>
            BLE Communication
          </Text>

          <View style={styles.logRow}>

            <Text style={styles.logLabel}>
              TX
            </Text>

            <Text style={styles.logValue}>
              {lastSent}
            </Text>

          </View>

          <View style={styles.logRow}>

            <Text style={styles.logLabel}>
              RX
            </Text>

            <Text style={styles.logValue}>
              {lastMessage}
            </Text>

          </View>

        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

/*
 * ------------------------------------------------
 * STYLES
 * ------------------------------------------------
 */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7FA",
    paddingHorizontal: 20,
  },

  header: {
    marginTop: 20,
    marginBottom: 25,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
  },

  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },

  connected: {
    backgroundColor: "#22C55E",
  },

  disconnected: {
    backgroundColor: "#EF4444",
  },

  running: {
    backgroundColor: "#22C55E",
  },

  stopped: {
    backgroundColor: "#9CA3AF",
  },

  statusText: {
    fontSize: 14,
    color: "#6B7280",
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginBottom: 15,
  },

  motorCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginBottom: 15,
  },

  motorStateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },

  motorStateText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },

  controlRow: {
    flexDirection: "row",
    gap: 12,
  },

  controlButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },

  startButton: {
    backgroundColor: "#16A34A",
  },

  stopButton: {
    backgroundColor: "#EF4444",
  },

  controlButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  hint: {
    marginTop: 14,
    fontSize: 12,
    color: "#9CA3AF",
  },

  pingCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginBottom: 15,
    alignItems: "center",
  },

  logCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
  },

  cardTitle: {
    fontSize: 19,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },

  deviceText: {
    color: "#6B7280",
    marginBottom: 18,
  },

  address: {
    fontSize: 12,
    color: "#9CA3AF",
    marginBottom: 15,
  },

  connectButton: {
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },

  disconnectButton: {
    backgroundColor: "#EF4444",
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },

  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginLeft: 10,
  },

  messageLabel: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 10,
  },

  message: {
    fontSize: 32,
    fontWeight: "700",
    color: "#111827",
    marginVertical: 15,
  },

  pingButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },

  disabledButton: {
    backgroundColor: "#CBD5E1",
  },

  pingButtonText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
  },

  deviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },

  deviceInfo: {
    flex: 1,
  },

  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },

  deviceAddress: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 3,
  },

  paired: {
    color: "#22C55E",
    fontWeight: "600",
    marginLeft: 10,
  },

  logRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },

  logLabel: {
    fontWeight: "700",
    color: "#6B7280",
  },

  logValue: {
    fontWeight: "600",
    color: "#111827",
  },
});