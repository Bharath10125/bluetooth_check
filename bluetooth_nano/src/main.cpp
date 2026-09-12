#include <Arduino.h>
#include <SoftwareSerial.h>

// HC-05
// Arduino D10 <- HC-05 TX
// Arduino D11 -> HC-05 RX
SoftwareSerial bluetooth(10, 11);

void setup() {
    Serial.begin(9600);
    bluetooth.begin(9600);

    Serial.println("Arduino + HC-05 ready");
}

void loop() {

    if (bluetooth.available()) {

        String message = bluetooth.readStringUntil('\n');
        message.trim();

        Serial.print("Received: ");
        Serial.println(message);

        if (message == "PING") {
            bluetooth.println("PONG");

            Serial.println("Sent: PONG");
        }
    }
}