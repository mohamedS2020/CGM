import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Alert,
  Platform,
  AppState,
  AppStateStatus,
  Linking
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { LineChart } from 'react-native-chart-kit';
import NfcManager from 'react-native-nfc-manager';
import MeasurementService, { GlucoseReading } from '../../services/MeasurementService';
import SensorNfcService, { NfcErrorType } from '../../services/SensorNfcService';
import GlucoseCalculationService from '../../services/GlucoseCalculationService';
import GlucoseMonitoringService from '../../services/GlucoseMonitoringService';
import NfcService from '../../services/NfcService';
import GlucoseReadingEvents from '../../services/GlucoseReadingEvents';

// Custom Tooltip component
interface TooltipProps {
  x: number;
  y: number;
  text: string;
  position?: 'top' | 'bottom';
  backgroundColor?: string;
  color?: string;
  width?: number;
  height?: number;
  borderRadius?: number;
  visible?: boolean;
}

const Tooltip = ({ 
  x, 
  y, 
  text, 
  position = 'top', 
  backgroundColor = '#333', 
  color = '#fff', 
  width = 120, 
  height = 50, 
  borderRadius = 8, 
  visible = true 
}: TooltipProps) => {
  if (!visible) return null;
  
  const positionStyles = {
    top: { bottom: y + 10 },
    bottom: { top: y + 10 }
  };
  
  return (
    <View 
      style={[
        {
          position: 'absolute' as const,
          left: x - width / 2,
          width,
          backgroundColor,
          borderRadius,
          padding: 8,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          zIndex: 999
        },
        positionStyles[position as keyof typeof positionStyles]
      ]}
    >
      {text.split('\n').map((line: string, i: number) => (
        <Text key={i} style={{ color, fontSize: 12, textAlign: 'center' as const }}>
          {line}
        </Text>
      ))}
    </View>
  );
};

// Initialize NFC Manager
NfcManager.start();

// Screen width for chart sizing
const screenWidth = Dimensions.get('window').width;

// Mock glucose level ranges
const GLUCOSE_LOW = 70;
const GLUCOSE_HIGH = 180;
const GLUCOSE_NORMAL_LOW = 70;
const GLUCOSE_NORMAL_HIGH = 140;

const HomeScreen = () => {
  const { user, userData } = useAuth();
  const [glucoseReadings, setGlucoseReadings] = useState<GlucoseReading[]>([]);
  const [lastReading, setLastReading] = useState<GlucoseReading | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartTimeframe, setChartTimeframe] = useState<'hour' | 'day' | 'week'>('day');
  const [scanning, setScanning] = useState(false);
  const [monitoringInterval, setMonitoringInterval] = useState(5 * 60 * 1000); // Keep for manual reading
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);
  const [nfcEnabled, setNfcEnabled] = useState<boolean | null>(null);
  
  // References
  const appStateRef = useRef(AppState.currentState);
  const nfcCheckIntervalRef = useRef<number | null>(null);
  const initialSyncCompletedRef = useRef(false);
  const isMountedRef = useRef(true);
  
  // Get service instances
  const nfcService = SensorNfcService.getInstance();
  const glucoseCalculationService = GlucoseCalculationService.getInstance();
  const monitoringService = GlucoseMonitoringService.getInstance();

  // Add ref to track NFC operations
  const nfcOperationInProgress = useRef(false);
  
  // Function to ensure NFC is cleaned up
  const ensureNfcCleanup = async () => {
    try {
      console.log('[HomeScreen] Ensuring NFC resources are cleaned up');
      const nfcCoreService = NfcService.getInstance();
      await nfcCoreService.forceCancelTechnologyRequest();
      nfcCoreService.setOperationInProgress(false);
      
      if (nfcService) {
        await nfcService.cleanup();
      }
      
      nfcOperationInProgress.current = false;
    } catch (error) {
      console.error('[HomeScreen] Error during NFC cleanup:', error);
      // Still mark as not in progress even if cleanup fails
      nfcOperationInProgress.current = false;
    }
  };

  // Fetch glucose readings
  const fetchGlucoseReadings = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // Check if we're online
      const netInfoState = await NetInfo.fetch();
      const isOnline = netInfoState.isConnected;
      
      // Set a timeout to prevent loading indefinitely
      const loadingTimeout = setTimeout(() => {
        console.log('Loading timeout reached, stopping loading state');
        setLoading(false);
      }, 5000); // 5 second timeout
      
      // Get latest reading first to show as current value
      const latestReadingPromise = MeasurementService.getLatestReading(user.uid);
      
      // Use Promise.race to implement a timeout for the fetch
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('FETCH_TIMEOUT')), 7000);
      });
      
      try {
        const latestReading = await Promise.race([latestReadingPromise, timeoutPromise]) as GlucoseReading;
        
        // If we have a latest reading, make sure it's displayed
        if (latestReading) {
          setLastReading(latestReading);
        }
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.message === 'FETCH_TIMEOUT') {
          console.log('Fetching latest reading timed out');
        } else {
          console.error('Error fetching latest reading:', fetchError);
        }
      }
      
      // Fetch readings based on the selected timeframe
      let readings: GlucoseReading[] = [];
      
      try {
        switch (chartTimeframe) {
          case 'hour':
            readings = await Promise.race([
              MeasurementService.getHourlyReadings(user.uid),
              timeoutPromise
            ]) as GlucoseReading[];
            break;
          case 'day':
            readings = await Promise.race([
              MeasurementService.getDailyReadings(user.uid),
              timeoutPromise
            ]) as GlucoseReading[];
            break;
          case 'week':
            readings = await Promise.race([
              MeasurementService.getWeeklyReadings(user.uid),
              timeoutPromise
            ]) as GlucoseReading[];
            break;
        }
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.message === 'FETCH_TIMEOUT') {
          console.log(`Fetching ${chartTimeframe} readings timed out`);
        } else {
          console.error(`Error fetching ${chartTimeframe} readings:`, fetchError);
        }
        
        // If we're offline, try to get offline readings directly
        if (!isOnline) {
          try {
            console.log('Offline mode: Getting locally stored readings');
            readings = await MeasurementService.getReadings(user.uid, { 
              timeframe: chartTimeframe,
              limit: 50
            });
          } catch (offlineError) {
            console.error('Error fetching offline readings:', offlineError);
          }
        }
      }
      
      // If we're in hour view and have a latest reading but no historical readings,
      // add the latest reading to the chart data
      if (chartTimeframe === 'hour' && readings.length === 0 && lastReading) {
        readings = [lastReading];
      }
      
      setGlucoseReadings(readings);
      
      // Log the state
      if (!isOnline) {
        console.log('Device is offline, using cached data');
      }
      
      // Clear the loading timeout since we're done
      clearTimeout(loadingTimeout);
    } catch (error) {
      console.error('Error fetching glucose readings:', error);
      if (!__DEV__) { // Only show in production
        Alert.alert('Error', 'Failed to fetch glucose readings');
      }
    } finally {
      setLoading(false);
    }
  };

  // Take a manual sensor reading
  const handleManualReading = async () => {
    // Check if already scanning
    if (scanning) {
      Alert.alert('Scan in Progress', 'A scan is already in progress. Please wait for it to complete.');
      return;
    }
    
    // Get the NFC core service for enabling/disabling foreground dispatch
    const nfcCoreService = NfcService.getInstance();
    
    // Force cleanup NFC system regardless of state before starting new scan
    try {
      console.log('[HomeScreen] Force cleaning up NFC system before new scan...');
      
      // Force cancel any technology request that might be hanging
      await nfcCoreService.forceCancelTechnologyRequest();
      
      // Reset operation in progress flags
      nfcCoreService.setOperationInProgress(false);
      nfcOperationInProgress.current = false;
      
      // Reset the NFC system
      await nfcCoreService.resetNfcSystem();
      
      // Clean up sensor service
      if (nfcService) {
        await nfcService.cleanup();
      }
      
      console.log('[HomeScreen] NFC system reset complete');
    } catch (cleanupError) {
      console.error('[HomeScreen] Error resetting NFC system:', cleanupError);
      // Continue anyway, as we'll attempt the scan
    }
    
    // Check if NFC operation is already in progress
    if (nfcOperationInProgress.current) {
      console.log('[HomeScreen] Attempting to scan while NFC operation is already in progress');
      Alert.alert(
        'NFC Busy',
        'Another NFC operation is in progress. Please wait a moment and try again.',
        [{ 
          text: 'Reset NFC', 
          onPress: async () => {
            try {
              await ensureNfcCleanup();
              Alert.alert('NFC Reset', 'The NFC system has been reset. Please try scanning again.');
            } catch (error) {
              console.error('[HomeScreen] Error resetting NFC:', error);
            }
          }
        }, { 
          text: 'Cancel' 
        }]
      );
      return;
    }
    
    try {
      setScanning(true);
      nfcOperationInProgress.current = true;
      
      // First check if NFC is available
      let isNfcAvailable = false;
      try {
        isNfcAvailable = await SensorNfcService.isNfcAvailable();
        console.log('[HomeScreen] Current NFC availability status:', isNfcAvailable);
      } catch (error) {
        console.error('[HomeScreen] Error checking NFC availability:', error);
      }
      
      if (!isNfcAvailable) {
        // First check if the device supports NFC at all
        let isNfcSupported = false;
        try {
          // This checks if the device has NFC hardware capability
          if (typeof NfcManager.isSupported === 'function') {
            isNfcSupported = await NfcManager.isSupported();
          }
        } catch (error) {
          console.error('Error checking NFC support:', error);
          isNfcSupported = false;
        }
        
        if (!isNfcSupported) {
          // Device doesn't support NFC at all
          Alert.alert(
            'NFC Not Supported',
            'Your device does not support NFC, which is required for scanning glucose sensors. This feature cannot be used on this device.',
            [{ text: 'OK' }]
          );
          setScanning(false);
          nfcOperationInProgress.current = false;
          return;
        }
        
        // Device supports NFC but it's disabled
        if (Platform.OS === 'android') {
          Alert.alert(
            'NFC Not Enabled',
            'Please enable NFC in your device settings to scan for sensors.',
            [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Open Settings',
                onPress: () => {
                  // Try direct intent first as it's more reliable
                  try {
                    console.log('Opening NFC settings via intent...');
                    Linking.sendIntent('android.settings.NFC_SETTINGS')
                      .catch(error => {
                        console.error('Error with direct intent:', error);
                        // Fall back to NfcManager if direct intent fails
                        SensorNfcService.openNfcSettings().catch(e => 
                          console.error('All NFC settings methods failed:', e)
                        );
                      });
                  } catch (error) {
                    console.error('Error trying to open settings:', error);
                    // Try the service method as fallback
                    SensorNfcService.openNfcSettings().catch(e => 
                      console.error('Fallback NFC settings also failed:', e)
                    );
                  }
                }
              }
            ]
          );
        } else if (Platform.OS === 'ios') {
          Alert.alert(
            'NFC Not Available',
            'NFC is required to read your glucose sensor. Please ensure your device supports NFC. On iOS, NFC can be enabled from the Control Center (swipe down from top-right corner and tap the NFC icon).',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert('NFC Not Available', 'Your device does not appear to support NFC, which is required for this feature.');
        }
        setScanning(false);
        nfcOperationInProgress.current = false;
        return;
      }
      
      // Check if NFC service is already performing an operation
      let isNfcBusy = false;
      try {
        if (nfcCoreService && typeof nfcCoreService.isOperationInProgress === 'function') {
          // Use resetIfStuck=true to attempt recovery if an operation appears to be stuck
          isNfcBusy = nfcCoreService.isOperationInProgress(true);
        }
      } catch (error) {
        console.error('Error checking NFC service status:', error);
      }
      
      if (isNfcBusy) {
        Alert.alert(
          'NFC Busy',
          'Another NFC operation is in progress. Please wait a moment and try again.',
          [{ 
            text: 'Reset NFC', 
            onPress: async () => {
              try {
                // Try to reset the NFC system
                await nfcCoreService.resetNfcSystem();
                Alert.alert('NFC Reset', 'The NFC system has been reset. Please try scanning again.');
              } catch (error) {
                console.error('Error resetting NFC:', error);
              }
            }
          }, { 
            text: 'Cancel' 
          }]
        );
        setScanning(false);
        nfcOperationInProgress.current = false;
        return;
      }
      
      // IMPORTANT: Explicitly enable NFC foreground dispatch right before scanning
      // This prevents automatic tag reading when not explicitly requested
      try {
        console.log('[HomeScreen] Enabling NFC foreground dispatch for manual scan...');
        await nfcCoreService.enableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[HomeScreen] Error enabling foreground dispatch:', dispatchError);
        // Continue anyway
      }
      
      // Try to take a manual reading using the monitoring service
      if (user) {
        try {
          // Take a manual reading without setting up continuous monitoring
          monitoringService.stopMonitoring(); // Make sure any existing monitoring is stopped
          const reading = await monitoringService.takeManualReading(user.uid);
          
          // Directly update state with new reading for immediate UI update
          setLastReading(reading);
          setGlucoseReadings(prevReadings => [reading, ...prevReadings]);
          
          // Show success message
          Alert.alert(
            'Reading Complete',
            `Your glucose level is ${reading.value} mg/dL.`,
            [{ text: 'OK' }]
          );
        } catch (error) {
          console.error('[HomeScreen] Error taking manual reading:', error);
          
          if (error instanceof Error) {
            // Handle specific error messages
            const errorMessage = error.message;
            
            if (errorMessage.includes('CONCURRENT_OPERATION') || 
                errorMessage.includes('another NFC operation')) {
              Alert.alert(
                'NFC Busy',
                'Another NFC operation is in progress. Please wait a moment and try again.',
                [{ 
                  text: 'Reset NFC', 
                  onPress: async () => {
                    try {
                      await ensureNfcCleanup();
                      Alert.alert('NFC Reset', 'The NFC system has been reset. Please try scanning again.');
                    } catch (error) {
                      console.error('[HomeScreen] Error resetting NFC:', error);
                    }
                  }
                }, { 
                  text: 'Cancel' 
                }]
              );
            } else if (errorMessage.includes('NOT_SUPPORTED')) {
              Alert.alert(
                'NFC Not Supported', 
                'It appears your device does not support NFC or it is currently disabled.'
              );
            } else if (errorMessage.includes('TAG_NOT_FOUND') || errorMessage.includes('No card found')) {
              Alert.alert(
                'Sensor Not Found', 
                'No glucose sensor was detected. Place your CGM sensor directly against the back of your phone and try again.',
                [{ text: 'OK' }]
              );
            } else if (errorMessage.includes('TIMEOUT')) {
              Alert.alert(
                'Scan Timeout', 
                'The scan took too long to complete. Please try again and keep your device near the sensor.',
                [{ text: 'OK' }]
              );
            } else if (errorMessage.includes('COMMUNICATION_ERROR')) {
              Alert.alert(
                'Communication Error',
                'Unable to read from sensor. Please make sure your sensor is properly positioned.',
                [{ text: 'OK' }]
              );
            } else if (errorMessage.includes('ALREADY_ACTIVE') || errorMessage.includes('SENSOR_ALREADY_ACTIVE')) {
              // This is the case when there's already an active sensor
              Alert.alert(
                'Sensor Already Active',
                'This sensor is already activated. You can continue taking readings with it. If you want to activate a new sensor, please go to the Sensor screen first.',
                [{ text: 'OK' }]
              );
            } else {
              Alert.alert(
                'Reading Error', 
                'Failed to take a glucose reading. Please ensure your sensor is properly placed and try again.'
              );
            }
          } else {
            Alert.alert(
              'Reading Error', 
              'Failed to take a glucose reading. Please ensure your sensor is properly placed and try again.'
            );
          }
        }
      }
    } catch (error) {
      console.error('[HomeScreen] Error initiating NFC scan:', error);
      Alert.alert('Error', 'Failed to initiate sensor scan. Please check if NFC is supported and enabled on your device.');
    } finally {
      // Always ensure cleanup and explicitly disable foreground dispatch
      setScanning(false);
      nfcOperationInProgress.current = false;
      
      try {
        // Explicitly disable NFC foreground dispatch after scanning
        // This prevents automatic tag reading when not scanning
        console.log('[HomeScreen] Disabling NFC foreground dispatch after manual scan');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[HomeScreen] Error disabling foreground dispatch:', dispatchError);
      }
      
      // Complete cleanup to ensure no resources are left open
      await ensureNfcCleanup();
    }
  };
  
  // Handle new reading from monitoring service
  const handleNewReading = (reading: GlucoseReading) => {
    console.log('New reading received:', reading);
    
    // Update the last reading
    setLastReading(reading);
    
    // Add to the readings list
    setGlucoseReadings(prevReadings => [reading, ...prevReadings]);
  };
  
  // Handle monitoring errors
  const handleMonitoringError = (error: Error) => {
    console.error('[HomeScreen] Monitoring error:', error);
    
    // Provide user-friendly feedback for common errors
    if (error.message.includes('TAG_NOT_FOUND')) {
      // This is expected when no sensor is connected - don't show an alert
      console.log('[HomeScreen] No sensor was detected during monitoring - this is normal if no sensor is present');
    } else if (error.message.includes('USER_CANCELLED')) {
      // User cancelled the scan, no need to show an alert
      console.log('[HomeScreen] Sensor scan was cancelled by the user');
    } else if (error.message.includes('CONCURRENT_OPERATION') || error.message.includes('in progress')) {
      // For concurrent operation errors, delay the alert to see if it resolves itself quickly
      // This prevents flashing alerts that disappear immediately
      if (scanning) {
        // Create a delay before showing the alert
        const delayTimer = setTimeout(() => {
          // Only show the alert if we're still in the scanning state
          if (scanning) {
            Alert.alert(
              'NFC Busy',
              'Another NFC operation is in progress. Monitoring will try again on the next cycle.',
              [{ 
                text: 'Reset NFC',
                onPress: async () => {
                  try {
                    await ensureNfcCleanup();
                    Alert.alert('NFC Reset', 'NFC has been reset and monitoring will continue.');
                  } catch (resetError) {
                    console.error('[HomeScreen] Error resetting NFC:', resetError);
                  }
                }
              }, {
                text: 'OK'
              }]
            );
          }
        }, 1500); // 1.5 second delay
        
        // Clear the timer if scanning state changes
        return () => clearTimeout(delayTimer);
      }
    } else {
      // For other errors
      Alert.alert(
        'Reading Error',
        'There was a problem reading your glucose sensor. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  // Filter readings based on selected timeframe
  const getFilteredReadings = (): GlucoseReading[] => {
    return glucoseReadings;
  };
  
  // Prepare data for the chart
  const getChartData = () => {
    const filteredReadings = getFilteredReadings();
    
    // Ensure readings are sorted by timestamp (oldest to newest for chart)
    const sortedReadings = [...filteredReadings].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    // Format the data for the chart
    return {
      labels: sortedReadings.map((reading, index) => {
        const date = new Date(reading.timestamp);
        if (isNaN(date.getTime())) return ''; // Prevent invalid date formatting
        
        if (chartTimeframe === 'hour') {
          return `${date.getHours().toString().padStart(2, '0')}:${date
            .getMinutes()
            .toString()
            .padStart(2, '0')}`;
        } else if (chartTimeframe === 'week') {
          return `${date.getMonth() + 1}/${date.getDate()}`;
        } else {
          // Day view - only show some hours to prevent label crowding
          // For 24 data points, show only every 4 hours
          const hour = date.getHours();
          if (sortedReadings.length >= 20) {
            // Many points - show fewer labels
            return hour % 4 === 0 ? `${hour.toString().padStart(2, '0')}:00` : '';
          } else if (sortedReadings.length >= 12) {
            // Medium number of points - show more labels
            return hour % 3 === 0 ? `${hour.toString().padStart(2, '0')}:00` : '';
          } else {
            // Few points - can show all labels
            return `${hour.toString().padStart(2, '0')}:00`;
          }
        }
      }),
      datasets: [
        {
          data: sortedReadings.map(reading => {
            // Filter out zero values (used for placeholder data) - will be skipped in chart
            const value = reading.value;
            return value === 0 ? 0 : value; // Replace null with 0 instead
          }),
          color: (opacity = 1) => `rgba(67, 97, 238, ${opacity})`,
          strokeWidth: 2,
        },
      ],
    };
  };
  
  // Get status color based on glucose level
  const getStatusColor = (value: number) => {
    if (value < glucoseCalculationService.GLUCOSE_LOW) return '#F72585'; // Low (red)
    if (value > glucoseCalculationService.GLUCOSE_HIGH) return '#F72585'; // High (red)
    if (
      value >= glucoseCalculationService.GLUCOSE_NORMAL_LOW &&
      value <= glucoseCalculationService.GLUCOSE_NORMAL_HIGH
    )
      return '#4CC9F0'; // Normal (blue)
    return '#FFC107'; // Warning (yellow)
  };
  
  // Format reading value for display
  const formatGlucoseValue = (value: number | null): string => {
    if (value === null || value === 0) return 'No data';
    return `${value} mg/dL`;
  };
  
  // Format timestamp based on chart view
  const formatTimestamp = (date: Date, view: 'hour' | 'day' | 'week'): string => {
    if (!date || isNaN(date.getTime())) return '';
    
    switch (view) {
      case 'hour':
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'day':
        return `${date.getHours().toString().padStart(2, '0')}:00`;
      case 'week':
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      default:
        return date.toLocaleString();
    }
  };
  
  // Get tooltip content for a data point
  const getTooltipContent = (dataPoint: any, index: number): string => {
    if (!glucoseReadings[index]) return '';
    
    const reading = glucoseReadings[index];
    const value = formatGlucoseValue(reading.value);
    const time = formatTimestamp(reading.timestamp, chartTimeframe);
    
    // Different tooltip content based on timeframe
    if (chartTimeframe === 'hour') {
      // For hourly view, show exact time and value
      return `${value}\n${time}${reading.comment ? `\n${reading.comment}` : ''}`;
    } else if (chartTimeframe === 'day') {
      // For daily view, show hour and average value
      const hour = reading.timestamp.getHours();
      return `${value}\n${hour}:00 - ${hour+1}:00${reading.comment ? `\n${reading.comment}` : ''}`;
    } else {
      // For weekly view, show date and average value
      const date = reading.timestamp.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric' 
      });
      return `${value}\n${date}${reading.comment ? `\n${reading.comment}` : ''}`;
    }
  };

  // Check NFC status periodically
  useEffect(() => {
    const checkNfcStatus = async () => {
      try {
        // First check if NfcManager is available
        if (!NfcManager || typeof NfcManager !== 'object') {
          console.warn('[HomeScreen] NfcManager is not available');
          setNfcSupported(false);
          setNfcEnabled(false);
          return;
        }

        // Check if isSupported method exists
        if (typeof NfcManager.isSupported !== 'function') {
          console.warn('[HomeScreen] NfcManager.isSupported is not a function');
          setNfcSupported(false);
          setNfcEnabled(false);
          return;
        }

        // Now it's safe to check if NFC is supported
        const isSupported = await NfcManager.isSupported();
        setNfcSupported(isSupported);
        
        if (isSupported) {
          try {
            // Check if NFC is enabled on Android
            if (Platform.OS === 'android') {
              // Check if isEnabled method exists
              if (typeof NfcManager.isEnabled !== 'function') {
                console.warn('[HomeScreen] NfcManager.isEnabled is not a function');
                setNfcEnabled(false);
                return;
              }
              
              const isEnabled = await NfcManager.isEnabled();
              setNfcEnabled(isEnabled);
            } else {
              // For iOS, we can't directly check if NFC is enabled
              // We'll rely on the SensorNfcService's check during scanning
              const isAvailable = await SensorNfcService.isNfcAvailable();
              setNfcEnabled(isAvailable);
            }
          } catch (error) {
            console.error('[HomeScreen] Error checking NFC enabled status:', error);
            setNfcEnabled(false);
          }
        } else {
          setNfcEnabled(false);
        }
      } catch (error) {
        console.error('[HomeScreen] Error checking NFC status:', error);
        setNfcSupported(false);
        setNfcEnabled(false);
      }
    };
    
    // Check NFC status immediately
    checkNfcStatus();
    
    // Set up a periodic check for NFC status with a longer interval
    // Changed from 10 seconds to 30 seconds to reduce frequency of checks
    nfcCheckIntervalRef.current = setInterval(checkNfcStatus, 30000);
    
    return () => {
      if (nfcCheckIntervalRef.current) {
        clearInterval(nfcCheckIntervalRef.current);
      }
    };
  }, []);

  // Initialize NFC service and monitoring service
  useEffect(() => {
    let mounted = true;
    
    const initializeServices = async () => {
      try {
        // Initialize NFC Service first to prevent Android system from handling tags
        // This needs to be done early in the app lifecycle
        const nfcCoreService = NfcService.getInstance();
        console.log('Initializing core NFC service...');
        try {
          await nfcCoreService.initialize();
          console.log('Core NFC service initialization completed');
          
          // Ensure any previous operations are canceled
          await nfcCoreService.forceCancelTechnologyRequest();
          nfcCoreService.setOperationInProgress(false);
        } catch (nfcCoreError) {
          console.error('Core NFC service initialization failed:', nfcCoreError);
        }
        
        // Now initialize sensor-specific NFC service
        if (nfcService) {
          console.log('Starting NFC initialization...');
          try {
            await nfcService.initialize();
            console.log('NFC initialization completed');
            
            // Also ensure any pending operations are canceled here
            await nfcService.cleanup();
          } catch (nfcError) {
            console.error('NFC initialization failed:', nfcError);
          }
        }
        
        // Only proceed with fetching readings if component is still mounted
        if (mounted && user) {
          fetchGlucoseReadings();
        }
      } catch (error) {
        console.error('Failed to initialize services:', error);
      }
    };
    
    // Start initialization
    initializeServices();
    
    return () => {
      // Mark component as unmounted
      mounted = false;
      
      // Clean up resources
      if (monitoringService.isMonitoring()) {
        monitoringService.stopMonitoring();
      }
      
      // Safely clean up NFC - first use the core service
      const nfcCoreService = NfcService.getInstance();
      if (nfcCoreService) {
        try {
          nfcCoreService.forceCancelTechnologyRequest();
          nfcCoreService.setOperationInProgress(false);
        } catch (error) {
          console.error('Error cleaning up core NFC service:', error);
        }
      }
      
      // Then clean up the sensor-specific service
      if (nfcService && typeof nfcService.cleanup === 'function') {
        try {
          nfcService.cleanup();
        } catch (error) {
          console.error('Error cleaning up NFC service:', error);
        }
      }
    };
  }, [user]);

  // Update monitoring state when app becomes active
  useEffect(() => {
    // App state tracking
    let lastAppStateChange = Date.now();
    const MIN_SYNC_INTERVAL = 10000; // 10 seconds between app foreground syncs
    
    // Add app state change listener
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (appStateRef.current !== 'active' && nextAppState === 'active') {
        // Re-check NFC availability when returning to the app
        // This helps detect if NFC was enabled in settings
        SensorNfcService.isNfcAvailable()
          .then(isAvailable => {
            console.log('NFC availability after returning to app:', isAvailable);
            // Force re-initialization if NFC is now available
            if (isAvailable && nfcService) {
              nfcService.initialize().catch(err => 
                console.error('Error re-initializing NFC after settings:', err)
              );
            }
          })
          .catch(err => console.error('Error checking NFC after settings:', err));
          
        // Throttle foreground syncs by checking time since last state change
        const now = Date.now();
        const timeSinceLastStateChange = now - lastAppStateChange;
        
        if (timeSinceLastStateChange >= MIN_SYNC_INTERVAL && user && isMountedRef.current) {
          // Update the last state change timestamp
          lastAppStateChange = now;
          
          // Check if we have internet and trigger sync only if enough time has passed
          NetInfo.fetch().then(state => {
            if (state.isConnected) {
              console.log('[HomeScreen] App returned to foreground with internet - syncing offline readings');
              
              MeasurementService.syncOfflineReadingsForUser(user.uid)
                .then(result => {
                  if (result && isMountedRef.current) {
                    console.log('[HomeScreen] Successfully synced offline readings');
                    // Reload readings after successful sync
                    fetchGlucoseReadings();
                  }
                })
                .catch(err => {
                  console.error('[HomeScreen] Error syncing readings:', err);
                });
            }
          });
        } else {
          console.log(`[HomeScreen] Skipping foreground sync - too soon since last state change (${timeSinceLastStateChange / 1000}s)`);
        }
      }
      
      // Update app state ref
      appStateRef.current = nextAppState;
        lastAppStateChange = Date.now();
    });
    
    return () => {
        appStateSubscription.remove();
      // Clean up resources
      if (monitoringService.isMonitoring()) {
        monitoringService.stopMonitoring();
      }
      
      // Safely clean up NFC - first use the core service
      const nfcCoreService = NfcService.getInstance();
      if (nfcCoreService) {
        try {
          nfcCoreService.forceCancelTechnologyRequest();
          nfcCoreService.setOperationInProgress(false);
        } catch (error) {
          console.error('Error cleaning up core NFC service:', error);
        }
      }
      
      // Then clean up the sensor-specific service
      if (nfcService && typeof nfcService.cleanup === 'function') {
        try {
          nfcService.cleanup();
        } catch (error) {
          console.error('Error cleaning up NFC service:', error);
        }
      }
    };
  }, [user]);

  // When the timeframe changes, refetch the data
  useEffect(() => {
    fetchGlucoseReadings();
  }, [chartTimeframe, user]);
  
  // This effect will update the chart data whenever lastReading changes
  useEffect(() => {
    if (lastReading && user) {
      // When a new reading comes in, we need to update the chart data based on the current timeframe
      // without changing the lastReading that we just set
      const updateChartData = async () => {
        try {
          let updatedReadings: GlucoseReading[] = [];
          
          switch (chartTimeframe) {
            case 'hour':
              updatedReadings = await MeasurementService.getHourlyReadings(user.uid);
              break;
            case 'day':
              updatedReadings = await MeasurementService.getDailyReadings(user.uid);
              break;
            case 'week':
              updatedReadings = await MeasurementService.getWeeklyReadings(user.uid);
              break;
          }
          
          // If no readings returned but we have a lastReading, include it for hour view
          if (chartTimeframe === 'hour' && updatedReadings.length === 0) {
            updatedReadings = [lastReading];
          }
          
          setGlucoseReadings(updatedReadings);
        } catch (error) {
          console.error('Error updating chart data after new reading:', error);
        }
      };
      
      updateChartData();
    }
  }, [lastReading, user, chartTimeframe]);

  // Try to sync offline readings when the screen loads
  useEffect(() => {
    const attemptInitialSync = async () => {
      if (user && isMountedRef.current && !initialSyncCompletedRef.current) {
        // Check if we have internet before attempting sync
        const state = await NetInfo.fetch();
        if (state.isConnected) {
          console.log('[HomeScreen] Initial sync of offline readings attempted');
          initialSyncCompletedRef.current = true; // Mark as attempted
          
          MeasurementService.syncOfflineReadingsForUser(user.uid)
            .then(result => {
              if (result && isMountedRef.current) {
                console.log('[HomeScreen] Successfully synced offline readings on initial load');
                // Reload readings after successful sync
                fetchGlucoseReadings();
              }
            })
            .catch(err => {
              console.error('[HomeScreen] Error syncing readings on initial load:', err);
            });
        }
      }
    };
    
    // Use a slight delay before attempting sync to avoid race conditions with other components
    const syncTimer = setTimeout(attemptInitialSync, 1000);
    
    return () => {
      clearTimeout(syncTimer);
    };
  }, [user]);

  // Update isMounted ref when component unmounts
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Subscribe to new readings from the event system
  useEffect(() => {
    // Subscribe to new reading events
    const readingsSubscription = GlucoseReadingEvents.getInstance().addNewReadingListener((newReading) => {
      console.log('[HomeScreen] New reading event received:', newReading);
      
      // Update the last reading
      setLastReading(newReading);
      
      // Also update the readings list for the chart
      setGlucoseReadings(prevReadings => {
        const updatedReadings = [newReading, ...prevReadings];
        
        // Sort by timestamp (newest first)
        updatedReadings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        return updatedReadings;
      });
    });
    
    return () => {
      // Clean up the subscription on unmount
      if (readingsSubscription && typeof readingsSubscription.remove === 'function') {
        readingsSubscription.remove();
      }
    };
  }, []);

  // Render NFC status indicator
  const renderNfcStatus = () => {
    if (nfcSupported === null || nfcEnabled === null) {
      return (
        <View style={styles.nfcStatusContainer}>
          <ActivityIndicator size="small" color="#999" />
          <Text style={styles.nfcStatusText}>Checking NFC status...</Text>
        </View>
      );
    }
    
    if (!nfcSupported) {
      return (
        <View style={styles.nfcStatusContainer}>
          <View style={[styles.nfcStatusIndicator, styles.nfcStatusNotSupported]} />
          <Text style={styles.nfcStatusText}>NFC not supported on this device</Text>
        </View>
      );
    }
    
    if (!nfcEnabled) {
      return (
        <View style={styles.nfcStatusContainer}>
          <View style={[styles.nfcStatusIndicator, styles.nfcStatusDisabled]} />
          <Text style={styles.nfcStatusText}>NFC is disabled. Please enable NFC in settings.</Text>
        </View>
      );
    }
    
    return (
      <View style={styles.nfcStatusContainer}>
        <View style={[styles.nfcStatusIndicator, styles.nfcStatusReady]} />
        <Text style={styles.nfcStatusText}>NFC ready</Text>
      </View>
    );
  };

  // Render scan button with clear instructions
  const renderScanButton = () => {
    return (
      <View style={styles.scanButtonContainer}>
        <TouchableOpacity 
          style={styles.scanButton}
          onPress={handleManualReading}
          disabled={scanning}
        >
          {scanning ? (
            <>
              <ActivityIndicator size="small" color="#fff" style={styles.scanButtonIcon} />
              <Text style={styles.scanButtonText}>Reading Sensor...</Text>
            </>
          ) : (
            <Text style={styles.scanButtonText}>Scan Sensor</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4361EE" />
        <Text style={styles.loadingText}>Loading glucose data...</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Text style={styles.welcomeText}>
          Hello, {userData?.displayName || user?.email?.split('@')[0]}
        </Text>
        <Text style={styles.dateText}>
          {new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </Text>
      </View>
      
      {/* Last Reading Display */}
      <View style={styles.lastReadingContainer}>
        <View 
          style={[
            styles.glucoseCircle, 
            { borderColor: lastReading ? getStatusColor(lastReading.value) : '#ddd' }
          ]}
        >
          {lastReading ? (
            <View style={styles.glucoseValueContainer}>
              <Text style={styles.glucoseValue}>{lastReading.value}</Text>
              <Text style={styles.glucoseUnit}>mg/dL</Text>
              <Text style={styles.timestamp}>
                {lastReading.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          ) : (
            <Text style={styles.noReadingText}>No Data</Text>
          )}
        </View>
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {lastReading ? (
              lastReading.value < GLUCOSE_LOW ? 'Low Glucose' :
              lastReading.value > GLUCOSE_HIGH ? 'High Glucose' :
              'Normal Glucose'
            ) : 'No Data'}
          </Text>
        </View>
      </View>
      
      {/* Chart Timeframe Selection */}
      <View style={styles.chartContainer}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>Glucose History</Text>
          <Text style={styles.chartSubtitle}>
            {chartTimeframe === 'hour' 
              ? 'Individual readings from past 60 minutes' 
              : chartTimeframe === 'day' 
                ? 'Hourly averages from past 24 hours' 
                : 'Daily averages from past 7 days'}
          </Text>
        </View>
        
        <View style={styles.chartControls}>
          <TouchableOpacity
            style={[styles.timeframeButton, chartTimeframe === 'hour' && styles.activeTimeframeButton]}
            onPress={() => setChartTimeframe('hour')}
          >
            <Text style={[styles.timeframeText, chartTimeframe === 'hour' && styles.activeTimeframeText]}>
              Hour
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.timeframeButton, chartTimeframe === 'day' && styles.activeTimeframeButton]}
            onPress={() => setChartTimeframe('day')}
          >
            <Text style={[styles.timeframeText, chartTimeframe === 'day' && styles.activeTimeframeText]}>
              Day
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.timeframeButton, chartTimeframe === 'week' && styles.activeTimeframeButton]}
            onPress={() => setChartTimeframe('week')}
          >
            <Text style={[styles.timeframeText, chartTimeframe === 'week' && styles.activeTimeframeText]}>
              Week
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Glucose History Chart */}
      <View style={styles.chartContainer}>
        {glucoseReadings.length > 0 ? (
          <LineChart
            data={getChartData()}
            width={screenWidth - 20}
            height={220}
            chartConfig={{
              backgroundColor: '#ffffff',
              backgroundGradientFrom: '#ffffff',
              backgroundGradientTo: '#ffffff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(67, 97, 238, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              propsForDots: {
                r: '4',
                strokeWidth: '2',
                stroke: '#4361EE',
              },
              propsForBackgroundLines: {
                stroke: '#E0E7FF',
                strokeWidth: 1,
              },
              // Ensure y-axis labels fit by setting proper margin/padding
              propsForLabels: {
                fontSize: 10,
              },
              // Make sure label formatting works correctly
              formatYLabel: (label) => label,
            }}
            withVerticalLabels={true}
            withHorizontalLabels={true}
            yAxisLabel=""
            yAxisSuffix=" mg/dL"
            withShadow={false}
            bezier
            style={{
              marginVertical: 8,
              borderRadius: 16,
            }}
            withDots={true}
            withInnerLines={true}
            withVerticalLines={true}
            withHorizontalLines={true}
            segments={4}
          />
        ) : (
          <View style={styles.noChartDataContainer}>
            <Text style={styles.noChartDataText}>No glucose history available</Text>
          </View>
        )}
      </View>
      
      {/* NFC Scan Button */}
      {renderScanButton()}
      
      {/* NFC Status Indicator */}
      {renderNfcStatus()}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  contentContainer: {
    paddingBottom: 120, // Ensure content isn't hidden behind tab bar
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  dateText: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  lastReadingContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  glucoseCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
    borderWidth: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
    elevation: 6,
  },
  glucoseValueContainer: {
    alignItems: 'center',
  },
  glucoseValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#333',
  },
  glucoseUnit: {
    fontSize: 18,
    color: '#666',
    marginTop: 5,
  },
  timestamp: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
  },
  noReadingText: {
    fontSize: 20,
    color: '#888',
  },
  statusContainer: {
    marginTop: 10,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  chartContainer: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  chartHeader: {
    alignItems: 'center',
    marginBottom: 10,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  chartSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  chartControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  timeframeButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginHorizontal: 5,
    backgroundColor: '#E0E7FF',
  },
  activeTimeframeButton: {
    backgroundColor: '#4361EE',
  },
  timeframeText: {
    fontSize: 14,
    color: '#666',
  },
  activeTimeframeText: {
    color: 'white',
  },
  chart: {
    borderRadius: 16,
    paddingRight: 20,
    marginTop: 10,
  },
  noChartDataContainer: {
    width: screenWidth - 40,
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
  },
  noChartDataText: {
    fontSize: 16,
    color: '#888',
  },
  scanButtonContainer: {
    alignItems: 'center',
    marginVertical: 30,
  },
  scanButton: {
    backgroundColor: '#4CC9F0',
    height: 56,
    minWidth: 220,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 28,
    marginHorizontal: 40,
    paddingHorizontal: 25,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    flexDirection: 'row',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  scanButtonIcon: {
    marginRight: 10,
  },
  monitoringContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginHorizontal: 15,
    marginTop: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  nfcStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 6,
    marginBottom: 15,
    marginHorizontal: 15,
    marginTop: 10,
  },
  nfcStatusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  nfcStatusReady: {
    backgroundColor: '#28a745',
  },
  nfcStatusDisabled: {
    backgroundColor: '#ffc107',
  },
  nfcStatusNotSupported: {
    backgroundColor: '#dc3545',
  },
  nfcStatusText: {
    fontSize: 14,
    color: '#555',
  },
});

export default HomeScreen; 