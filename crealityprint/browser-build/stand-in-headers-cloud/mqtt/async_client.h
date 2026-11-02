// The names Creality Print's mqtt_client.h takes from the Paho MQTT C++ library, for the browser build, which has
// no MQTT (a browser tab cannot open the TCP connection anyway): Creality Cloud printer messages are not in the
// browser version. mqtt_client.cpp and CloudDeviceMqttTransport.cpp are replaced by stand-ins/creality_cloud_none.cpp.
#pragma once
#include <memory>
#include <string>
namespace mqtt {
class message;
class delivery_token;
using const_message_ptr  = std::shared_ptr<const message>;
using delivery_token_ptr = std::shared_ptr<delivery_token>;
class callback {
public:
    virtual ~callback() = default;
    virtual void connected(const std::string&) {}
    virtual void connection_lost(const std::string&) {}
    virtual void message_arrived(const_message_ptr) {}
    virtual void delivery_complete(delivery_token_ptr) {}
};
class connect_options {};
class async_client {};
} // namespace mqtt
