#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "nvs_flash.h"

#include "esp_log.h"
#include "esp_system.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"

#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"

#include "host/ble_hs.h"
#include "host/ble_gatt.h"
#include "host/ble_uuid.h"

#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"


/* ============================================================
 * CHANGE THIS FOR EACH FIRMWARE VERSION
 * ============================================================ */

#define APP_MESSAGE "Changed the frimware"


static const char *TAG = "BLE_OTA";


/* ============================================================
 * APPLICATION MODE
 * ============================================================ */

typedef enum
{
    APP_MODE_NORMAL = 0,
    APP_MODE_OTA

} app_mode_t;


/*
 * Current operating mode.
 *
 * NORMAL:
 *      Normal application is running.
 *
 * OTA:
 *      Normal application activity is paused.
 *      Only OTA related BLE operations are processed.
 */

static volatile app_mode_t app_mode =
    APP_MODE_NORMAL;


/* ============================================================
 * UUIDs
 * ============================================================ */

static const ble_uuid128_t service_uuid =
    BLE_UUID128_INIT(
        0x10, 0x0f, 0x0e, 0x0d,
        0x0c, 0x0b, 0x0a, 0x09,
        0x08, 0x07, 0x06, 0x05,
        0x04, 0x03, 0x02, 0x01
    );


static const ble_uuid128_t message_uuid =
    BLE_UUID128_INIT(
        0x20, 0x1f, 0x1e, 0x1d,
        0x1c, 0x1b, 0x1a, 0x19,
        0x18, 0x17, 0x16, 0x15,
        0x14, 0x13, 0x12, 0x11
    );


static const ble_uuid128_t control_uuid =
    BLE_UUID128_INIT(
        0x30, 0x2f, 0x2e, 0x2d,
        0x2c, 0x2b, 0x2a, 0x29,
        0x28, 0x27, 0x26, 0x25,
        0x24, 0x23, 0x22, 0x21
    );


static const ble_uuid128_t data_uuid =
    BLE_UUID128_INIT(
        0x40, 0x3f, 0x3e, 0x3d,
        0x3c, 0x3b, 0x3a, 0x39,
        0x38, 0x37, 0x36, 0x35,
        0x34, 0x33, 0x32, 0x31
    );


static const ble_uuid128_t status_uuid =
    BLE_UUID128_INIT(
        0x50, 0x4f, 0x4e, 0x4d,
        0x4c, 0x4b, 0x4a, 0x49,
        0x48, 0x47, 0x46, 0x45,
        0x44, 0x43, 0x42, 0x41
    );


/* ============================================================
 * OTA STATE
 * ============================================================ */

static esp_ota_handle_t ota_handle;

static const esp_partition_t *update_partition =
    NULL;

static size_t ota_received = 0;


/* ============================================================
 * BLE STATE
 * ============================================================ */

static uint16_t connection_handle =
    BLE_HS_CONN_HANDLE_NONE;


/* BLE characteristic handles */

static uint16_t message_handle;

static uint16_t status_handle;


/* ============================================================
 * BLE NOTIFICATION
 * ============================================================ */

static void notify_text(
    uint16_t handle,
    const char *text
)
{
    if (connection_handle ==
        BLE_HS_CONN_HANDLE_NONE)
    {
        return;
    }


    struct os_mbuf *om =
        ble_hs_mbuf_from_flat(
            text,
            strlen(text)
        );


    if (om == NULL)
    {
        ESP_LOGE(
            TAG,
            "Failed to allocate BLE buffer"
        );

        return;
    }


    int rc =
        ble_gatts_notify_custom(
            connection_handle,
            handle,
            om
        );


    if (rc != 0)
    {
        ESP_LOGE(
            TAG,
            "Notification failed: %d",
            rc
        );
    }
}


/* ============================================================
 * OTA START
 * ============================================================ */

static void ota_start(void)
{
    /*
     * Do not allow another START while
     * an OTA session is already active.
     */

    if (app_mode == APP_MODE_OTA)
    {
        ESP_LOGW(
            TAG,
            "OTA already active"
        );


        notify_text(
            status_handle,
            "ERROR:ALREADY_STARTED"
        );


        return;
    }


    /*
     * Select the OTA partition that is not
     * currently running.
     */

    update_partition =
        esp_ota_get_next_update_partition(
            NULL
        );


    if (update_partition == NULL)
    {
        ESP_LOGE(
            TAG,
            "No OTA partition available"
        );


        notify_text(
            status_handle,
            "ERROR:NO_PARTITION"
        );


        return;
    }


    ESP_LOGI(
        TAG,
        "OTA partition: %s",
        update_partition->label
    );


    /*
     * Begin OTA write.
     */

    esp_err_t err =
        esp_ota_begin(
            update_partition,
            OTA_SIZE_UNKNOWN,
            &ota_handle
        );


    if (err != ESP_OK)
    {
        ESP_LOGE(
            TAG,
            "esp_ota_begin failed: %s",
            esp_err_to_name(err)
        );


        update_partition = NULL;


        notify_text(
            status_handle,
            "ERROR:OTA_BEGIN"
        );


        return;
    }


    /*
     * OTA is now officially active.
     *
     * From this point onward, normal
     * application behavior must stop.
     */

    app_mode = APP_MODE_OTA;

    ota_received = 0;


    ESP_LOGI(
        TAG,
        "================================"
    );

    ESP_LOGI(
        TAG,
        "OTA MODE STARTED"
    );

    ESP_LOGI(
        TAG,
        "Normal application paused"
    );

    ESP_LOGI(
        TAG,
        "================================"
    );


    notify_text(
        status_handle,
        "READY"
    );
}


/* ============================================================
 * OTA WRITE
 * ============================================================ */

static void ota_write_data(
    const uint8_t *data,
    size_t len
)
{
    /*
     * DATA is only valid during OTA mode.
     */

    if (app_mode != APP_MODE_OTA)
    {
        notify_text(
            status_handle,
            "ERROR:NOT_STARTED"
        );


        return;
    }


    esp_err_t err =
        esp_ota_write(
            ota_handle,
            data,
            len
        );


    if (err != ESP_OK)
    {
        ESP_LOGE(
            TAG,
            "esp_ota_write failed: %s",
            esp_err_to_name(err)
        );


        /*
         * Abort broken OTA session.
         */

        esp_ota_abort(
            ota_handle
        );


        ota_received = 0;

        update_partition = NULL;

        app_mode = APP_MODE_NORMAL;


        ESP_LOGW(
            TAG,
            "OTA failed - returning to NORMAL mode"
        );


        notify_text(
            status_handle,
            "ERROR:WRITE"
        );


        return;
    }


    ota_received += len;
}


/* ============================================================
 * OTA FINISH
 * ============================================================ */

static void ota_finish(void)
{
    /*
     * END is only valid while OTA is active.
     */

    if (app_mode != APP_MODE_OTA)
    {
        notify_text(
            status_handle,
            "ERROR:NOT_STARTED"
        );


        return;
    }


    ESP_LOGI(
        TAG,
        "Received %d bytes",
        (int)ota_received
    );


    /*
     * Finish writing and validate the
     * firmware image.
     */

    esp_err_t err =
        esp_ota_end(
            ota_handle
        );


    if (err != ESP_OK)
    {
        ESP_LOGE(
            TAG,
            "OTA validation failed: %s",
            esp_err_to_name(err)
        );


        ota_received = 0;

        update_partition = NULL;

        app_mode = APP_MODE_NORMAL;


        ESP_LOGW(
            TAG,
            "Invalid image - returning to NORMAL mode"
        );


        notify_text(
            status_handle,
            "ERROR:INVALID_IMAGE"
        );


        return;
    }


    /*
     * Select newly written partition
     * as the next boot partition.
     */

    err =
        esp_ota_set_boot_partition(
            update_partition
        );


    if (err != ESP_OK)
    {
        ESP_LOGE(
            TAG,
            "Set boot partition failed: %s",
            esp_err_to_name(err)
        );


        ota_received = 0;

        update_partition = NULL;

        app_mode = APP_MODE_NORMAL;


        ESP_LOGW(
            TAG,
            "Boot partition failed - returning to NORMAL mode"
        );


        notify_text(
            status_handle,
            "ERROR:SET_BOOT"
        );


        return;
    }


    /*
     * OTA completed successfully.
     */

    ESP_LOGI(
        TAG,
        "================================"
    );

    ESP_LOGI(
        TAG,
        "OTA SUCCESS"
    );

    ESP_LOGI(
        TAG,
        "Next boot: %s",
        update_partition->label
    );

    ESP_LOGI(
        TAG,
        "================================"
    );


    /*
     * Tell the laptop that OTA succeeded.
     */

    notify_text(
        status_handle,
        "SUCCESS"
    );


    /*
     * Give BLE stack enough time to
     * transmit SUCCESS notification.
     */

    vTaskDelay(
        pdMS_TO_TICKS(500)
    );


    ESP_LOGI(
        TAG,
        "Restarting into new firmware..."
    );


    esp_restart();
}


/* ============================================================
 * GATT ACCESS CALLBACK
 * ============================================================ */

static int gatt_access_cb(
    uint16_t conn_handle,
    uint16_t attr_handle,
    struct ble_gatt_access_ctxt *ctxt,
    void *arg
)
{
    const ble_uuid_t *uuid =
        ctxt->chr->uuid;


    /* ========================================================
     * CONTROL CHARACTERISTIC
     * ======================================================== */

    if (ble_uuid_cmp(
            uuid,
            &control_uuid.u
        ) == 0)
    {
        char command[32];


        size_t len =
            OS_MBUF_PKTLEN(
                ctxt->om
            );


        if (len >= sizeof(command))
        {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }


        os_mbuf_copydata(
            ctxt->om,
            0,
            len,
            command
        );


        command[len] = '\0';


        ESP_LOGI(
            TAG,
            "CONTROL: %s",
            command
        );


        /*
         * START OTA
         */

        if (strcmp(
                command,
                "START"
            ) == 0)
        {
            ota_start();
        }


        /*
         * END OTA
         */

        else if (
            strcmp(
                command,
                "END"
            ) == 0
        )
        {
            ota_finish();
        }


        /*
         * Unknown command
         */

        else
        {
            notify_text(
                status_handle,
                "ERROR:UNKNOWN_COMMAND"
            );
        }


        return 0;
    }


    /* ========================================================
     * DATA CHARACTERISTIC
     * ======================================================== */

    if (ble_uuid_cmp(
            uuid,
            &data_uuid.u
        ) == 0)
    {
        size_t len =
            OS_MBUF_PKTLEN(
                ctxt->om
            );


        uint8_t buffer[256];


        if (len > sizeof(buffer))
        {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }


        os_mbuf_copydata(
            ctxt->om,
            0,
            len,
            buffer
        );


        ota_write_data(
            buffer,
            len
        );


        return 0;
    }


    return 0;
}


/* ============================================================
 * GATT TABLE
 * ============================================================ */

static const struct ble_gatt_svc_def gatt_services[] =
{
    {
        .type =
            BLE_GATT_SVC_TYPE_PRIMARY,

        .uuid =
            &service_uuid.u,

        .characteristics =
            (struct ble_gatt_chr_def[])
        {

            /*
             * MESSAGE
             *
             * ESP32 -> Laptop
             *
             * Normal application data.
             */

            {
                .uuid =
                    &message_uuid.u,

                .access_cb =
                    gatt_access_cb,

                .val_handle =
                    &message_handle,

                .flags =
                    BLE_GATT_CHR_F_NOTIFY,
            },


            /*
             * CONTROL
             *
             * Laptop -> ESP32
             *
             * START / END
             */

            {
                .uuid =
                    &control_uuid.u,

                .access_cb =
                    gatt_access_cb,

                .flags =
                    BLE_GATT_CHR_F_WRITE |
                    BLE_GATT_CHR_F_WRITE_NO_RSP,
            },


            /*
             * DATA
             *
             * Laptop -> ESP32
             *
             * Firmware binary.
             */

            {
                .uuid =
                    &data_uuid.u,

                .access_cb =
                    gatt_access_cb,

                .flags =
                    BLE_GATT_CHR_F_WRITE |
                    BLE_GATT_CHR_F_WRITE_NO_RSP,
            },


            /*
             * STATUS
             *
             * ESP32 -> Laptop
             *
             * READY / SUCCESS / ERROR
             */

            {
                .uuid =
                    &status_uuid.u,

                .access_cb =
                    gatt_access_cb,

                .val_handle =
                    &status_handle,

                .flags =
                    BLE_GATT_CHR_F_NOTIFY,
            },


            { 0 }
        },
    },


    { 0 }
};


/* ============================================================
 * MESSAGE TASK
 * ============================================================ */

static void message_task(
    void *arg
)
{
    while (1)
    {
        /*
         * Normal application messages are
         * ONLY sent in NORMAL mode.
         *
         * As soon as START is received:
         *
         *     NORMAL -> OTA
         *
         * this condition becomes false.
         */

        if (connection_handle !=
                BLE_HS_CONN_HANDLE_NONE &&
            app_mode ==
                APP_MODE_NORMAL)
        {
            notify_text(
                message_handle,
                APP_MESSAGE
            );
        }


        vTaskDelay(
            pdMS_TO_TICKS(1000)
        );
    }
}


/* ============================================================
 * GAP EVENT CALLBACK
 * ============================================================ */

static void start_advertising(void);


static int gap_event(
    struct ble_gap_event *event,
    void *arg
)
{
    switch (event->type)
    {

    /* --------------------------------------------------------
     * CONNECT
     * -------------------------------------------------------- */

    case BLE_GAP_EVENT_CONNECT:

        if (event->connect.status == 0)
        {
            connection_handle =
                event->connect.conn_handle;


            ESP_LOGI(
                TAG,
                "BLE CONNECTED"
            );
        }

        else
        {
            connection_handle =
                BLE_HS_CONN_HANDLE_NONE;


            ESP_LOGI(
                TAG,
                "BLE connection failed"
            );


            start_advertising();
        }

        break;


    /* --------------------------------------------------------
     * DISCONNECT
     * -------------------------------------------------------- */

    case BLE_GAP_EVENT_DISCONNECT:

        connection_handle =
            BLE_HS_CONN_HANDLE_NONE;


        ESP_LOGI(
            TAG,
            "BLE DISCONNECTED"
        );


        /*
         * If the device disconnects during OTA,
         * the OTA session is no longer useful.
         *
         * Abort it and return to NORMAL mode.
         */

        if (app_mode == APP_MODE_OTA)
        {
            ESP_LOGW(
                TAG,
                "BLE disconnected during OTA"
            );


            esp_ota_abort(
                ota_handle
            );


            ota_received = 0;

            update_partition = NULL;

            app_mode = APP_MODE_NORMAL;


            ESP_LOGW(
                TAG,
                "OTA aborted - NORMAL mode restored"
            );
        }


        start_advertising();

        break;


    default:

        break;
    }


    return 0;
}


/* ============================================================
 * ADVERTISING
 * ============================================================ */

static void start_advertising(void)
{
    struct ble_hs_adv_fields fields;


    memset(
        &fields,
        0,
        sizeof(fields)
    );


    fields.flags =
        BLE_HS_ADV_F_DISC_GEN |
        BLE_HS_ADV_F_BREDR_UNSUP;


    const char *name =
        "XIAO-BLE-DFU";


    fields.name =
        (uint8_t *)name;


    fields.name_len =
        strlen(name);


    fields.name_is_complete =
        1;


    int rc =
        ble_gap_adv_set_fields(
            &fields
        );


    if (rc != 0)
    {
        ESP_LOGE(
            TAG,
            "Advertising setup failed: %d",
            rc
        );


        return;
    }


    struct ble_gap_adv_params params;


    memset(
        &params,
        0,
        sizeof(params)
    );


    params.conn_mode =
        BLE_GAP_CONN_MODE_UND;


    params.disc_mode =
        BLE_GAP_DISC_MODE_GEN;


    /*
     * NimBLE GAP event callback is supplied
     * directly to ble_gap_adv_start().
     */

    rc =
        ble_gap_adv_start(
            BLE_OWN_ADDR_PUBLIC,
            NULL,
            BLE_HS_FOREVER,
            &params,
            gap_event,
            NULL
        );


    if (rc != 0)
    {
        ESP_LOGE(
            TAG,
            "Advertising failed: %d",
            rc
        );


        return;
    }


    ESP_LOGI(
        TAG,
        "Advertising as %s",
        name
    );
}


/* ============================================================
 * BLE HOST TASK
 * ============================================================ */

static void ble_host_task(
    void *param
)
{
    ESP_LOGI(
        TAG,
        "NimBLE host task started"
    );


    nimble_port_run();


    nimble_port_freertos_deinit();


    vTaskDelete(NULL);
}


/* ============================================================
 * BLE SYNC
 * ============================================================ */

static void ble_sync(void)
{
    ESP_LOGI(
        TAG,
        "BLE synchronized"
    );


    start_advertising();
}


/* ============================================================
 * MAIN
 * ============================================================ */

void app_main(void)
{
    ESP_LOGI(
        TAG,
        "=============================="
    );


    ESP_LOGI(
        TAG,
        "       XIAO BLE OTA"
    );


    ESP_LOGI(
        TAG,
        "       MESSAGE: %s",
        APP_MESSAGE
    );


    ESP_LOGI(
        TAG,
        "       MODE: NORMAL"
    );


    ESP_LOGI(
        TAG,
        "=============================="
    );


    /* --------------------------------------------------------
     * NVS
     * -------------------------------------------------------- */

    esp_err_t ret =
        nvs_flash_init();


    if (ret ==
            ESP_ERR_NVS_NO_FREE_PAGES ||
        ret ==
            ESP_ERR_NVS_NEW_VERSION_FOUND)
    {
        ESP_ERROR_CHECK(
            nvs_flash_erase()
        );


        ret =
            nvs_flash_init();
    }


    ESP_ERROR_CHECK(ret);


    /* --------------------------------------------------------
     * NimBLE
     *
     * nimble_port_init() initializes the
     * ESP NimBLE HCI transport internally
     * in this ESP-IDF version.
     * -------------------------------------------------------- */

    nimble_port_init();


    /* --------------------------------------------------------
     * GAP / GATT
     * -------------------------------------------------------- */

    ble_svc_gap_init();

    ble_svc_gatt_init();


    ble_svc_gap_device_name_set(
        "XIAO-BLE-DFU"
    );


    /* --------------------------------------------------------
     * Register GATT
     * -------------------------------------------------------- */

    int rc =
        ble_gatts_count_cfg(
            gatt_services
        );


    if (rc != 0)
    {
        ESP_LOGE(
            TAG,
            "GATT count failed: %d",
            rc
        );


        return;
    }


    rc =
        ble_gatts_add_svcs(
            gatt_services
        );


    if (rc != 0)
    {
        ESP_LOGE(
            TAG,
            "GATT add failed: %d",
            rc
        );


        return;
    }


    /* --------------------------------------------------------
     * NimBLE callbacks
     * -------------------------------------------------------- */

    ble_hs_cfg.sync_cb =
        ble_sync;


    /*
     * DO NOT use:
     *
     * ble_hs_cfg.gap_event = ...
     *
     * ESP-IDF 6.1 NimBLE does not provide
     * that field.
     */


    /* --------------------------------------------------------
     * Start BLE host
     * -------------------------------------------------------- */

    nimble_port_freertos_init(
        ble_host_task
    );


    /* --------------------------------------------------------
     * Start application message task
     * -------------------------------------------------------- */

    xTaskCreate(
        message_task,
        "message_task",
        4096,
        NULL,
        5,
        NULL
    );
}