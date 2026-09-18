import asyncio
import sys
from bleak import BleakScanner, BleakClient


DEVICE_NAME = "XIAO-BLE-DFU"

MESSAGE_UUID = "11121314-1516-1718-191a-1b1c1d1e1f20"
CONTROL_UUID = "21222324-2526-2728-292a-2b2c2d2e2f30"
DATA_UUID = "31323334-3536-3738-393a-3b3c3d3e3f40"
STATUS_UUID = "41424344-4546-4748-494a-4b4c4d4e4f50"

FIRMWARE = ".pio/build/seeed_xiao_esp32c3/firmware.bin"

CHUNK_SIZE = 180


async def main():

    print("=" * 50)
    print("       XIAO BLE OTA UPDATE")
    print("=" * 50)

    print("\nScanning...")

    device = await BleakScanner.find_device_by_name(
        DEVICE_NAME,
        timeout=10
    )

    if device is None:
        print("XIAO-BLE-DFU not found")
        return

    print(f"Found: {device.address}")

    print("\nConnecting...")

    async with BleakClient(device) as client:

        print("Connected!")

        # -------------------------------------------------
        # Notifications
        # -------------------------------------------------

        def message_handler(sender, data):
            try:
                print(f"[MESSAGE] {data.decode()}")
            except UnicodeDecodeError:
                print(f"[MESSAGE] {data!r}")

        def status_handler(sender, data):
            try:
                print(f"[STATUS] {data.decode()}")
            except UnicodeDecodeError:
                print(f"[STATUS] {data!r}")

        await client.start_notify(
            MESSAGE_UUID,
            message_handler
        )

        await client.start_notify(
            STATUS_UUID,
            status_handler
        )

        print("Notifications enabled")

        # -------------------------------------------------
        # Read firmware
        # -------------------------------------------------

        with open(FIRMWARE, "rb") as f:
            firmware = f.read()

        print(f"\nFirmware: {FIRMWARE}")
        print(f"Size:     {len(firmware)} bytes")

        # -------------------------------------------------
        # Start OTA
        # -------------------------------------------------

        print("\nStarting OTA...")

        await client.write_gatt_char(
            CONTROL_UUID,
            b"START",
            response=True
        )

        await asyncio.sleep(1)

        # -------------------------------------------------
        # Send firmware
        # -------------------------------------------------

        total = len(firmware)
        sent = 0

        print("\nUploading...")

        while sent < total:

            chunk = firmware[
                sent:sent + CHUNK_SIZE
            ]

            await client.write_gatt_char(
                DATA_UUID,
                chunk,
                response=True
            )

            sent += len(chunk)

            percent = (sent / total) * 100

            print(
                f"\r{sent}/{total} bytes "
                f"({percent:6.2f}%)",
                end="",
                flush=True
            )

        print("\n")

        # -------------------------------------------------
        # Finish OTA
        # -------------------------------------------------

        print("Finishing OTA...")

        await client.write_gatt_char(
            CONTROL_UUID,
            b"END",
            response=True
        )

        print("\nWaiting for ESP32 reboot...")

        await asyncio.sleep(5)

    print("\nOTA process finished.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
