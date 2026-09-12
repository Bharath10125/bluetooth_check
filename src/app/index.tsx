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

import RNBluetoothClassic from "react-native-bluetooth-classic";

type BluetoothDevice = {
  id: string;
  name: string;
  address?: string;
  bonded?: boolean;
};

const CONNECT_TIMEOUT_MS = 15000;

export default function HomeScreen() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);

  const [lastMessage, setLastMessage] = useState("Waiting...");
  const [pingCount, setPingCount] = useState(0);

  // Keep a ref mirror of `device` so the read listener always sees the
  // freshest connection without needing to be re-subscribed unnecessarily.
  const deviceRef = useRef<BluetoothDevice | null>(null);

  /*
   * ------------------------------------------------
   * PERMISSIONS (Android 12+ requires runtime grants)
   * ------------------------------------------------
   */

  const requestBluetoothPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== "android") {
      return true;
    }

    // Permissions were introduced at API 31 (Android 12).
    if (Platform.Version < 31) {
      return true;
    }

    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);

      const allGranted = Object.values(granted).every(
        (status) => status === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!allGranted) {
        Alert.alert(
          "Permissions Required",
          "Bluetooth permissions are needed to find and connect to HC-05. Please grant them in your device settings."
        );
      }

      return allGranted;
    } catch (error) {
      console.error("Permission request failed:", error);
      return false;
    }
  };

  /*
   * ------------------------------------------------
   * GET PAIRED BLUETOOTH DEVICES
   * ------------------------------------------------
   */

  const getBluetoothDevices = async (silent = false) => {
    try {
      const bondedDevices = await RNBluetoothClassic.getBondedDevices();

      console.log("Paired Bluetooth devices:", bondedDevices);

      setDevices(bondedDevices);

      return bondedDevices;
    } catch (error) {
      console.error("Failed to get Bluetooth devices:", error);

      // Don't alert during silent/background checks (e.g. on mount before
      // the user has taken any action) — only surface this for
      // user-initiated calls.
      if (!silent) {
        Alert.alert(
          "Bluetooth Error",
          "Could not get paired Bluetooth devices."
        );
      }

      return [];
    }
  };

  /*
   * ------------------------------------------------
   * CONNECT TO HC-05
   * ------------------------------------------------
   */

  const connectToHC05 = async () => {
    if (connecting) {
      return;
    }

    try {
      setConnecting(true);

      const hasPermissions = await requestBluetoothPermissions();

      if (!hasPermissions) {
        setConnecting(false);
        return;
      }

      /*
       * Make sure Bluetooth is enabled
       */

      const enabled = await RNBluetoothClassic.isBluetoothEnabled();

      console.log("Bluetooth enabled:", enabled);

      if (!enabled) {
        Alert.alert(
          "Bluetooth Disabled",
          "Please enable Bluetooth on your phone."
        );

        setConnecting(false);

        return;
      }

      /*
       * Get paired devices
       */

      const bondedDevices = await getBluetoothDevices();

      console.log("Available paired devices:", bondedDevices);

      /*
       * Find HC-05
       */

      const hc05 = bondedDevices.find((item: BluetoothDevice) =>
        item.name?.toUpperCase().includes("HC-05")
      );

      /*
       * HC-05 not found
       */

      if (!hc05) {
        Alert.alert(
          "HC-05 Not Found",
          "Please pair HC-05 with your phone first from Android Bluetooth settings."
        );

        setConnecting(false);

        return;
      }

      console.log("HC-05 found:", hc05);

      /*
       * REAL BLUETOOTH CONNECTION (with a manual timeout, since classic
       * connect() can hang indefinitely if the device is unresponsive)
       */

      const connectPromise = RNBluetoothClassic.connectToDevice(hc05.id, {
        DELIMITER: "\n",
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Connection timed out")),
          CONNECT_TIMEOUT_MS
        );
      });

      const connectedDevice = await Promise.race([
        connectPromise,
        timeoutPromise,
      ]);

      console.log("Bluetooth connected:", connectedDevice);

      /*
       * Save connected device
       */

      setDevice(connectedDevice as BluetoothDevice);
      deviceRef.current = connectedDevice as BluetoothDevice;

      setConnected(true);

      setLastMessage("Connected");
    } catch (error) {
      console.error("HC-05 connection failed:", error);

      setConnected(false);
      setDevice(null);
      deviceRef.current = null;

      const message =
        error instanceof Error && error.message === "Connection timed out"
          ? "Connection to HC-05 timed out. Make sure it's powered on and in range."
          : "Could not connect to HC-05.";

      Alert.alert("Connection Failed", message);
    } finally {
      setConnecting(false);
    }
  };

  /*
   * ------------------------------------------------
   * DISCONNECT
   * ------------------------------------------------
   */

  const disconnectBluetooth = async () => {
    try {
      if (device) {
        await RNBluetoothClassic.disconnectFromDevice(device.id);
      }

      setConnected(false);
      setDevice(null);
      deviceRef.current = null;

      setLastMessage("Disconnected");
    } catch (error) {
      console.error("Disconnect error:", error);

      /*
       * Reset UI anyway
       */

      setConnected(false);
      setDevice(null);
      deviceRef.current = null;
    }
  };

  /*
   * ------------------------------------------------
   * SEND PING
   * ------------------------------------------------
   */

  const sendPing = async () => {
    if (!connected || !device) {
      Alert.alert("Not Connected", "Connect to HC-05 first.");
      return;
    }

    try {
      console.log("TX: PING");

      /*
       * Arduino expects:
       *
       * PING\n
       */

      await RNBluetoothClassic.writeToDevice(device.id, "PING\n");

      /*
       * Update UI
       */

      setPingCount((count) => count + 1);

      setLastMessage("PING");
    } catch (error) {
      console.error("PING failed:", error);

      Alert.alert("Bluetooth Error", "Failed to send PING.");
    }
  };

  /*
   * ------------------------------------------------
   * RECEIVE DATA FROM ARDUINO
   * ------------------------------------------------
   */

  useEffect(() => {
    if (!device) {
      return;
    }

    console.log("Starting Bluetooth listener for:", device.id);

    let subscription: { remove?: () => void } | undefined;

    try {
      subscription = RNBluetoothClassic.onDeviceRead(
        device.id,
        (event: any) => {
          console.log("RX:", event);

          const message = event?.data ?? "";

          const cleanMessage = String(message).trim();

          if (!cleanMessage) {
            return;
          }

          console.log("Arduino message:", cleanMessage);

          setLastMessage(cleanMessage);
        }
      );
    } catch (error) {
      console.error("Failed to start Bluetooth listener:", error);
    }

    return () => {
      console.log("Removing Bluetooth listener");

      subscription?.remove?.();
    };
  }, [device]);

  /*
   * ------------------------------------------------
   * INITIAL BLUETOOTH CHECK
   * ------------------------------------------------
   */

  useEffect(() => {
    const initializeBluetooth = async () => {
      try {
        if (Platform.OS === "android" && Platform.Version >= 31) {
          const alreadyGranted =
            (await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
            )) &&
            (await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
            ));

          if (!alreadyGranted) {
            // Don't prompt or alert on cold start — just skip the silent
            // pre-fetch and let the user trigger the permission request
            // via the Connect button.
            return;
          }
        }

        const enabled = await RNBluetoothClassic.isBluetoothEnabled();

        console.log("Bluetooth enabled:", enabled);

        if (enabled) {
          await getBluetoothDevices(true);
        }
      } catch (error) {
        console.error("Bluetooth initialization error:", error);
      }
    };

    initializeBluetooth();
  }, []);

  /*
   * ------------------------------------------------
   * CLEAN UP CONNECTION ON UNMOUNT
   * ------------------------------------------------
   */

  useEffect(() => {
    return () => {
      if (deviceRef.current) {
        RNBluetoothClassic.disconnectFromDevice(deviceRef.current.id).catch(
          (error) => console.error("Unmount disconnect error:", error)
        );
      }
    };
  }, []);

  /*
   * ------------------------------------------------
   * UI
   * ------------------------------------------------
   */

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* HEADER */}

        <View style={styles.header}>
          <Text style={styles.title}>Bluetooth Ping Pong</Text>

          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusDot,
                connected ? styles.connected : styles.disconnected,
              ]}
            />

            <Text style={styles.statusText}>
              {connected ? "Connected" : "Disconnected"}
            </Text>
          </View>
        </View>

        {/* HC-05 CARD */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>HC-05</Text>

          <Text style={styles.deviceText}>
            {device ? device.name : "No device connected"}
          </Text>

          {device && (
            <Text style={styles.address}>Address: {device.id}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.connectButton,
              connected && styles.disconnectButton,
            ]}
            onPress={connected ? disconnectBluetooth : connectToHC05}
            disabled={connecting}
          >
            {connecting ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color="#FFFFFF" />

                <Text style={[styles.buttonText, styles.loadingText]}>
                  Connecting...
                </Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>
                {connected ? "Disconnect" : "Connect HC-05"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* PING CARD */}

        <View style={styles.pingCard}>
          <Text style={styles.cardTitle}>Ping Pong</Text>

          <Text style={styles.messageLabel}>Last Message</Text>

          <Text style={styles.message}>{lastMessage}</Text>

          <TouchableOpacity
            style={[styles.pingButton, !connected && styles.disabledButton]}
            onPress={sendPing}
            disabled={!connected}
          >
            <Text style={styles.pingButtonText}>PING</Text>
          </TouchableOpacity>

          <Text style={styles.counter}>Ping Count: {pingCount}</Text>
        </View>

        {/* PAIRED DEVICES */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Paired Devices</Text>

          {devices.length === 0 ? (
            <Text style={styles.deviceText}>No paired Bluetooth devices</Text>
          ) : (
            devices.map((item: BluetoothDevice) => (
              <View key={item.id} style={styles.deviceRow}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>
                    {item.name || "Unknown Device"}
                  </Text>

                  <Text style={styles.deviceAddress}>{item.id}</Text>
                </View>

                <Text style={styles.paired}>Paired</Text>
              </View>
            ))
          )}
        </View>

        {/* COMMUNICATION LOG */}

        <View style={styles.logCard}>
          <Text style={styles.cardTitle}>Communication</Text>

          <View style={styles.logRow}>
            <Text style={styles.logLabel}>TX</Text>

            <Text style={styles.logValue}>
              {pingCount > 0 ? "PING" : "-"}
            </Text>
          </View>

          <View style={styles.logRow}>
            <Text style={styles.logLabel}>RX</Text>

            <Text style={styles.logValue}>
              {lastMessage.includes("PONG") ? "PONG" : "-"}
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

  counter: {
    marginTop: 15,
    color: "#6B7280",
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