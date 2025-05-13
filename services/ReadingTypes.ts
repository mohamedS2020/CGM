/**
 * Common types for glucose readings
 * This file is used to break circular dependencies between services
 */

// Define reading source enum
export enum ReadingSource {
  MANUAL_SCAN = 'manual_scan',
  AUTO_MONITOR = 'auto_monitor',
  CALIBRATION = 'calibration',
  LIBRE_SENSOR = 'libre_sensor'
}

// Extend the GlucoseReading interface in MeasurementService
declare module './MeasurementService' {
  export interface GlucoseReading {
    source?: ReadingSource;
    userId?: string;
  }
} 