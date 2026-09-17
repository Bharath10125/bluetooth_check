#include <Arduino.h>
#include <NimBLEDevice.h>

// =====================================================
// PINS
// =====================================================

const int LED = 8;

const int IN1 = 4;
const int IN2 = 5;
const int IN3 = 6;
const int IN4 = 7;

// =====================================================
// BLE
// =====================================================

#define SERVICE_UUID \
    "4fafc201-1fb5-459e-8fcc-c5c9c331914b"

#define CHARACTERISTIC_UUID \
    "beb5483e-36e1-4688-b7f5-ea07361b26a8"

NimBLECharacteristic *characteristic;

// =====================================================
// MOTOR
// =====================================================

bool motorRunning = false;

const uint8_t stepSequence[8][4] = {
    {1, 0, 0, 0},
    {1, 1, 0, 0},
    {0, 1, 0, 0},
    {0, 1, 1, 0},
    {0, 0, 1, 0},
    {0, 0, 1, 1},
    {0, 0, 0, 1},
    {1, 0, 0, 1}
};

int currentStep = 0;

unsigned long lastStepTime = 0;

// Motor speed
// Smaller = faster
const unsigned long STEP_DELAY = 3;


// =====================================================
// MOTOR FUNCTIONS
// =====================================================

void setMotorStep(int step)
{
    digitalWrite(IN1, stepSequence[step][0]);
    digitalWrite(IN2, stepSequence[step][1]);
    digitalWrite(IN3, stepSequence[step][2]);
    digitalWrite(IN4, stepSequence[step][3]);
}


void stopMotor()
{
    motorRunning = false;

    // Turn all coils OFF
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, LOW);
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, LOW);

    Serial.println("MOTOR: STOPPED");
}


void startMotor()
{
    motorRunning = true;

    Serial.println("MOTOR: STARTED");
}


void updateMotor()
{
    if (!motorRunning)
        return;

    unsigned long now = millis();

    if (now - lastStepTime >= STEP_DELAY)
    {
        lastStepTime = now;

        setMotorStep(currentStep);

        currentStep++;

        if (currentStep >= 8)
            currentStep = 0;
    }
}


// =====================================================
// BLE CALLBACK
// =====================================================

class CommandCallbacks : public NimBLECharacteristicCallbacks
{
    void onWrite(
        NimBLECharacteristic *pCharacteristic,
        NimBLEConnInfo &connInfo
    ) override
    {
        String command = pCharacteristic->getValue().c_str();

        command.trim();
        command.toUpperCase();

        Serial.print("BLE COMMAND: ");
        Serial.println(command);

        // -------------------------
        // START
        // -------------------------

        if (command == "START")
        {
            startMotor();

            pCharacteristic->setValue("MOTOR STARTED");
            pCharacteristic->notify();
        }

        // -------------------------
        // STOP
        // -------------------------

        else if (command == "STOP")
        {
            stopMotor();

            pCharacteristic->setValue("MOTOR STOPPED");
            pCharacteristic->notify();
        }

        // -------------------------
        // PING
        // -------------------------

        else if (command == "PING")
        {
            Serial.println("PING received");

            pCharacteristic->setValue("PONG");
            pCharacteristic->notify();
        }

        // -------------------------
        // UNKNOWN
        // -------------------------

        else
        {
            Serial.println("Unknown command");

            pCharacteristic->setValue("UNKNOWN COMMAND");
            pCharacteristic->notify();
        }
    }
};


// =====================================================
// SETUP
// =====================================================

void setup()
{
    Serial.begin(115200);

    delay(1000);

    // -------------------------
    // GPIO
    // -------------------------

    pinMode(LED, OUTPUT);

    pinMode(IN1, OUTPUT);
    pinMode(IN2, OUTPUT);
    pinMode(IN3, OUTPUT);
    pinMode(IN4, OUTPUT);

    stopMotor();

    // -------------------------
    // BLE INITIALIZATION
    // -------------------------

    NimBLEDevice::init("ESP32-C3-Stepper");

    Serial.println();
    Serial.println("==============================");
    Serial.println(" ESP32-C3 STEPPER CONTROLLER");
    Serial.println("==============================");

    Serial.print("BLE Address: ");
    Serial.println(
        NimBLEDevice::getAddress().toString().c_str()
    );

    // -------------------------
    // SERVER
    // -------------------------

    NimBLEServer *server = NimBLEDevice::createServer();

    // -------------------------
    // SERVICE
    // -------------------------

    NimBLEService *service =
        server->createService(SERVICE_UUID);

    // -------------------------
    // CHARACTERISTIC
    // -------------------------

    characteristic =
        service->createCharacteristic(
            CHARACTERISTIC_UUID,
            NIMBLE_PROPERTY::READ |
            NIMBLE_PROPERTY::WRITE |
            NIMBLE_PROPERTY::NOTIFY
        );

    characteristic->setValue("ESP32-C3 Ready");

    characteristic->setCallbacks(
        new CommandCallbacks()
    );

    // -------------------------
    // START SERVER
    // -------------------------

    server->start();

    // -------------------------
    // ADVERTISING
    // -------------------------

    NimBLEAdvertising *advertising =
        NimBLEDevice::getAdvertising();

    advertising->addServiceUUID(SERVICE_UUID);
    advertising->setName("ESP32-C3-Stepper");
    advertising->start();

    // -------------------------
    // DONE
    // -------------------------

    Serial.println("BLE Name: ESP32-C3-Stepper");
    Serial.println("BLE Advertising: STARTED");
    Serial.println();
    Serial.println("Commands:");
    Serial.println("  START");
    Serial.println("  STOP");
    Serial.println("  PING");
    Serial.println("==============================");
}


// =====================================================
// LOOP
// =====================================================

void loop()
{
    updateMotor();

    // LED indicates motor state
    digitalWrite(LED, motorRunning ? HIGH : LOW);
}