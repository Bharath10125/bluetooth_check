import asyncio
from bleak import BleakScanner, BleakClient


DEVICE_NAME = "XIAO-BLE-DFU"

MESSAGE_UUID = "11121314-1516-1718-191a-1b1c1d1e1f20"


async def main():

    print()
    print("===================================")
    print("       XIAO BLE RECEIVE TEST")
    print("===================================")
    print()

    print("Scanning...")

    device = await BleakScanner.find_device_by_name(
        DEVICE_NAME,
        timeout=10
    )

    if device is None:
        print("XIAO-BLE-DFU not found")
        return

    print(f"Found: {device.address}")
    print()

    async with BleakClient(device) as client:

        print("Connected!")
        print()

        def message_handler(sender, data):

            try:
                message = data.decode("utf-8")

            except UnicodeDecodeError:
                message = repr(data)

            print(f"[ESP32] {message}")

        await client.start_notify(
            MESSAGE_UUID,
            message_handler
        )

        print("Subscribed to MESSAGE")
        print()
        print("Receiving...")
        print("Press Ctrl+C to stop.")
        print()

        while True:
            await asyncio.sleep(1)


if __name__ == "__main__":

    try:
        asyncio.run(main())

    except KeyboardInterrupt:
        print("\nStopped.")