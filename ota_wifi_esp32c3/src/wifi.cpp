#include <WiFi.h>
#include <ArduinoOTA.h>

const char* ssid = "Green Collar";
const char* password = "gcawifi@123";

void setup()
{
    Serial.begin(115200);

    WiFi.begin(ssid, password);

    while (WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());

    ArduinoOTA.setHostname("xiao-c3");

    ArduinoOTA.begin();

    Serial.println("OTA Ready");
}

void loop()
{
    ArduinoOTA.handle();

    Serial.println("HI HELLO");

    delay(1000);
}