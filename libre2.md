Implement the logic to read and decrypt FreeStyle Libre 2 sensor data using NFC (ISO 15693 protocol). Here's the sensor memory layout (43 pages × 8 bytes = 344 bytes total):

| Block Addr | Description                          |
| ---------- | ------------------------------------ |
| 0x00–0x0F  | Sensor metadata, serial number, CRC  |
| 0x10–0x1F  | Factory calibration data (Encrypted) |
| 0x20–0x2F  | Glucose history raw data (Encrypted) |
| 0x30–0x3F  | Trend data (Encrypted)               |
| 0x40–0x43  | CRCs, padding                        |

Steps:
1. **Read NFC Memory**: Use a library like `nfcpy` to read all 43 memory blocks from the sensor (ISO 15693 standard).
2. **Extract Important Blocks**:
   - Sensor serial number from Block 0x00–0x0F
   - Encrypted calibration data from Block 0x10–0x1F
   - Encrypted glucose history (0x20–0x2F) and trend data (0x30–0x3F)
3. **Authenticate & Decrypt**:
   - Implement challenge-response authentication using the sensor UID.
   - Derive session encryption keys based on challenge/response data.
   - Decrypt encrypted blocks using the **Speck128** block cipher algorithm.
   - Verify the integrity of decrypted data using **CMAC**.
   - Use reference decryption logic from:
     - https://github.com/glucometers-tech/freestyle-keys
     - https://github.com/Neridaj/libre2-py
     - https://github.com/ps2/libre2 (C implementation)

4. **Parse Decrypted Data**:
   - Glucose entries include:
     - Timestamp (relative to sensor activation)
     - Raw glucose reading
     - Quality/validity flags
   - Convert raw values using calibration formula:
     ```
     glucose = (slope * raw_value + intercept) / scale
     ```
     The calibration coefficients (slope, intercept, scale) are extracted from the decrypted calibration data.

5. **Validate Readings**:
   - Compare parsed values to known readings from the LibreLink app (if available).

Optional additions (please include in the implementation):
✅ Generate or reuse **Speck128/CMAC decryption** routines  
✅ Stub and test the key derivation logic  
✅ Parse decrypted Trend and History block buffers into human-readable JSON  
✅ Add data visualization: plot trend/history glucose values over time using a chart library (e.g., Chart.js, matplotlib)  
✅ Ensure all parts are modular and testable independently (NFC reading, decryption, parsing, calibration)  
✅ Add mock data to allow unit testing without live sensor input

The goal is to recreate accurate glucose readings from the FreeStyle Libre 2 sensor using decrypted raw data, matching the values shown in the official Libre apps.
