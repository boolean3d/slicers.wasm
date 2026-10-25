/* hidapi with no devices: a browser tab has no USB HID access through this API. */
#include <stddef.h>
#include "hidapi.h"

int HID_API_EXPORT hid_init(void) { return 0; }
int HID_API_EXPORT hid_exit(void) { return 0; }
struct hid_device_info HID_API_EXPORT *hid_enumerate(unsigned short vendor_id, unsigned short product_id) { (void)vendor_id; (void)product_id; return NULL; }
void HID_API_EXPORT hid_free_enumeration(struct hid_device_info *devs) { (void)devs; }
hid_device HID_API_EXPORT *hid_open(unsigned short vendor_id, unsigned short product_id, const wchar_t *serial_number) { (void)vendor_id; (void)product_id; (void)serial_number; return NULL; }
hid_device HID_API_EXPORT *hid_open_path(const char *path) { (void)path; return NULL; }
int HID_API_EXPORT hid_write(hid_device *dev, const unsigned char *data, size_t length) { (void)dev; (void)data; (void)length; return -1; }
int HID_API_EXPORT hid_read_timeout(hid_device *dev, unsigned char *data, size_t length, int milliseconds) { (void)dev; (void)data; (void)length; (void)milliseconds; return -1; }
int HID_API_EXPORT hid_read(hid_device *dev, unsigned char *data, size_t length) { (void)dev; (void)data; (void)length; return -1; }
int HID_API_EXPORT hid_set_nonblocking(hid_device *dev, int nonblock) { (void)dev; (void)nonblock; return -1; }
void HID_API_EXPORT hid_close(hid_device *dev) { (void)dev; }
const wchar_t HID_API_EXPORT *hid_error(hid_device *dev) { (void)dev; return L"no HID devices in the browser"; }
int HID_API_EXPORT_CALL hid_get_manufacturer_string(hid_device *dev, wchar_t *string, size_t maxlen) { (void)dev; (void)string; (void)maxlen; return -1; }
int HID_API_EXPORT_CALL hid_get_product_string(hid_device *dev, wchar_t *string, size_t maxlen) { (void)dev; (void)string; (void)maxlen; return -1; }
