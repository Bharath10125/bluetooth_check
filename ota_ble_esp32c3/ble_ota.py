import asyncio
from bleak import BleakScanner, BleakClient
from bleak.exc import BleakError


DEVICE_NAME = "XIAO-BLE-DFU"

MESSAGE_UUID = "11121314-1516-1718-191a-1b1c1d1e1f20"
CONTROL_UUID = "21222324-2526-2728-292a-2b2c2d2e2f30"
DATA_UUID = "31323334-3536-3738-393a-3b3c3d3e3f40"
STATUS_UUID = "41424344-4546-4748-494a-4b4c4d4e4f50"

FIRMWARE = ".pio/build/seeed_xiao_esp32c3/firmware.bin"

CHUNK_SIZE = 180


# ============================================================
# OTA STATUS
# ============================================================

ready_event = asyncio.Event()
success_event = asyncio.Event()
error_event = asyncio.Event()

ota_error = None


# ============================================================
# MAIN
# ============================================================

async def main():

    global ota_error

    print("=" * 50)
    print("       XIAO BLE OTA UPDATE")
    print("=" * 50)


    # --------------------------------------------------------
    # Scan
    # --------------------------------------------------------

    print("\nScanning...")

    device = await BleakScanner.find_device_by_name(
        DEVICE_NAME,
        timeout=10
    )

    if device is None:
        print("XIAO-BLE-DFU not found")
        return


    print(f"Found: {device.address}")


    # --------------------------------------------------------
    # Connect
    # --------------------------------------------------------

    print("\nConnecting...")


    try:

        async with BleakClient(device) as client:

            print("Connected!")


            # =================================================
            # NOTIFICATIONS
            # =================================================

            def message_handler(sender, data):

                try:
                    message = data.decode()

                except UnicodeDecodeError:
                    message = repr(data)


                # -------------------------------------------------
                # IMPORTANT:
                #
                # During OTA the ESP32 should NOT send MESSAGE.
                # So normally we shouldn't see this while uploading.
                # -------------------------------------------------

                print(f"[MESSAGE] {message}")


            def status_handler(sender, data):

                global ota_error

                try:
                    status = data.decode()

                except UnicodeDecodeError:
                    status = repr(data)


                print(f"[STATUS] {status}")


                # ---------------------------------------------
                # OTA READY
                # ---------------------------------------------

                if status == "READY":

                    ready_event.set()


                # ---------------------------------------------
                # OTA SUCCESS
                # ---------------------------------------------

                elif status == "SUCCESS":

                    success_event.set()


                # ---------------------------------------------
                # OTA ERROR
                # ---------------------------------------------

                elif status.startswith("ERROR:"):

                    ota_error = status

                    error_event.set()


            await client.start_notify(
                MESSAGE_UUID,
                message_handler
            )


            await client.start_notify(
                STATUS_UUID,
                status_handler
            )


            print("Notifications enabled")


            # =================================================
            # READ FIRMWARE
            # =================================================

            try:

                with open(FIRMWARE, "rb") as f:
                    firmware = f.read()

            except FileNotFoundError:

                print(f"\nFirmware not found:")
                print(FIRMWARE)

                return


            total = len(firmware)


            print(f"\nFirmware: {FIRMWARE}")
            print(f"Size:     {total} bytes")


            # =================================================
            # START OTA
            # =================================================

            print("\nStarting OTA...")


            ready_event.clear()
            success_event.clear()
            error_event.clear()

            ota_error = None


            await client.write_gatt_char(
                CONTROL_UUID,
                b"START",
                response=True
            )


            # -------------------------------------------------
            # Wait for READY
            # -------------------------------------------------

            try:

                await asyncio.wait_for(
                    ready_event.wait(),
                    timeout=5
                )

            except asyncio.TimeoutError:

                print("\nERROR: ESP32 did not send READY")

                return


            print("ESP32 entered OTA mode")


            # =================================================
            # SEND FIRMWARE
            # =================================================

            sent = 0


            print("\nUploading...")


            while sent < total:

                # ---------------------------------------------
                # Check whether ESP32 reported an error
                # ---------------------------------------------

                if error_event.is_set():

                    print(
                        f"\nESP32 reported: {ota_error}"
                    )

                    return


                chunk = firmware[
                    sent:sent + CHUNK_SIZE
                ]


                await client.write_gatt_char(
                    DATA_UUID,
                    chunk,
                    response=True
                )


                sent += len(chunk)


                percent = (
                    sent / total
                ) * 100


                print(
                    f"\r{sent}/{total} bytes "
                    f"({percent:6.2f}%)",
                    end="",
                    flush=True
                )


            print("\n")


            # =================================================
            # FINISH OTA
            # =================================================

            print("Finishing OTA...")


            await client.write_gatt_char(
                CONTROL_UUID,
                b"END",
                response=True
            )


            # =================================================
            # WAIT FOR SUCCESS
            # =================================================

            print("Waiting for OTA validation...")


            try:

                await asyncio.wait_for(
                    asyncio.gather(
                        success_event.wait(),
                        error_event.wait(),
                        return_exceptions=True
                    ),
                    timeout=10
                )

            except asyncio.TimeoutError:

                print(
                    "\nERROR: No SUCCESS/ERROR response "
                    "from ESP32"
                )

                return


            # -------------------------------------------------
            # Check result
            # -------------------------------------------------

            if error_event.is_set():

                print(
                    f"\nOTA FAILED: {ota_error}"
                )

                return


            if success_event.is_set():

                print(
                    "\nOTA SUCCESS!"
                )

                print(
                    "ESP32 is restarting..."
                )


            # =================================================
            # WAIT FOR REBOOT
            # =================================================

            try:

                await asyncio.sleep(5)

            except asyncio.CancelledError:

                pass


    # ========================================================
    # EXPECTED DISCONNECT
    # ========================================================

    except BleakError as e:

        # ESP32 intentionally disconnects when
        # esp_restart() is called.
        #
        # Therefore a BLE disconnect immediately
        # after SUCCESS is expected.

        if success_event.is_set():

            print(
                "\nBLE disconnected because "
                "ESP32 restarted."
            )

        else:

            print(
                f"\nBLE error: {e}"
            )

            return


    print(
        "\nOTA process finished."
    )


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    try:

        asyncio.run(main())

    except KeyboardInterrupt:

        print("\nStopped.")