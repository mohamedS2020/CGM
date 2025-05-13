import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Platform,
  Linking,
  AppState,
  SafeAreaView,
  StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase/firebaseconfig';
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit, deleteDoc, doc, updateDoc, setDoc, where } from 'firebase/firestore';
import NfcManager from 'react-native-nfc-manager';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import SensorNfcService, { NfcErrorType, ISensorInfo } from '../../services/SensorNfcService';
import { NfcTech } from 'react-native-nfc-manager';
import NfcService from '../../services/NfcService';
import { SensorStatusService } from '../../services/SensorStatusService';
import GlucoseCalculationService from '../../services/GlucoseCalculationService';
import NfcScanGuide from '../../components/NfcScanGuide';
import SensorDetectionService, { SensorType } from '../../services/SensorDetectionService';
import FreeStyleLibreService, { LibreSensorInfo } from '../../services/FreeStyleLibreService';
import GlucoseMonitoringService from '../../services/GlucoseMonitoringService';
import MeasurementService from '../../services/MeasurementService';
import { RootStackParamList } from '../../navigation';
import { CompositeNavigationProp } from '@react-navigation/native';
import { TabParamList } from '../../navigation/TabNavigator';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

// Define a more specific navigation type
type StartSensorScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<RootStackParamList>,
  BottomTabNavigationProp<TabParamList>
>;

// Initialize NFC Manager
try {
  console.log('[StartSensorScreen] Initializing NFC Manager on import');
  NfcManager.start();
} catch (error) {
  console.error('[StartSensorScreen] Error initializing NFC Manager on import:', error);
}

// Constants for sensor caching
const SENSOR_CACHE_KEY = 'cgm_current_sensor';

// Interface for sensor data
interface Sensor {
  id?: string;
  serialNumber: string;
  startedAt: Date;
  expiresAt: Date;
  manufacturer: string;
  model: string;
  status: 'active' | 'expired' | 'removed';
  batteryLevel?: number | null;
  lastReading?: number | null;
  lastReadingTime?: Date | null;
}

const StartSensorScreen = () => {
  const { user } = useAuth();
  const navigation = useNavigation<StartSensorScreenNavigationProp>();
  const nfcService = SensorNfcService.getInstance();
  const sensorStatusService = SensorStatusService;
  const glucoseService = GlucoseCalculationService.getInstance();
  
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [currentSensor, setCurrentSensor] = useState<Sensor | null>(null);
  const [loading, setLoading] = useState(true);
  const [nfcAvailable, setNfcAvailable] = useState<boolean | null>(null);
  const [verifyingSensor, setVerifyingSensor] = useState(false);
  const [sensorTestResult, setSensorTestResult] = useState<{success: boolean, reading: number | null, error?: string} | null>(null);
  const [showScanGuide, setShowScanGuide] = useState(false);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<{success: boolean, message: string} | null>(null);
  const [sensorType, setSensorType] = useState<SensorType>(SensorType.RF430);
  const [libreSensorInfo, setLibreSensorInfo] = useState<LibreSensorInfo | null>(null);
  
  // Add a ref to track if an NFC operation is in progress
  const nfcOperationInProgress = useRef(false);
  // Add a ref for cleanup function
  const cleanupRef = useRef<(() => void) | null>(null);
  
  // Get service instances for new sensor types
  const sensorDetectionService = SensorDetectionService.getInstance();
  const libreService = FreeStyleLibreService.getInstance();
  const monitoringService = GlucoseMonitoringService.getInstance();
  
  // Fetch current active sensor on mount
  useEffect(() => {
    const fetchCurrentSensor = async () => {
      if (!user) return;
      
      try {
        console.log('[StartSensorScreen] Fetching current sensor for user:', user.uid);
        
        // Check if we're online
        const netInfoState = await NetInfo.fetch();
        const isOnline = netInfoState.isConnected;
        
        // First try to get from cache to show something immediately
        try {
          const cachedSensorData = await AsyncStorage.getItem(`${SENSOR_CACHE_KEY}_${user.uid}`);
          if (cachedSensorData) {
            const parsedSensor = JSON.parse(cachedSensorData);
            console.log('[StartSensorScreen] Using cached sensor data while fetching from Firestore');
            
            // Convert string dates back to Date objects
            const sensor = {
              ...parsedSensor,
              startedAt: new Date(parsedSensor.startedAt),
              expiresAt: new Date(parsedSensor.expiresAt),
              lastReadingTime: parsedSensor.lastReadingTime ? new Date(parsedSensor.lastReadingTime) : null
            };
            
            // Only set as current if status is active
            if (sensor.status === 'active') {
              setCurrentSensor(sensor);
            }
          }
        } catch (cacheError) {
          console.error('[StartSensorScreen] Error reading cached sensor data:', cacheError);
        }
        
        // If we're online, fetch from Firestore
        if (isOnline) {
          const sensorsRef = collection(db, 'users', user.uid, 'sensors');
          const q = query(
            sensorsRef,
            orderBy('startedAt', 'desc'),
            limit(1)
          );
          
          const querySnapshot = await getDocs(q);
          
          if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            const data = doc.data();
            
            console.log(`[StartSensorScreen] Found sensor document with ID: ${doc.id}, status: ${data.status}`);
            
            // Only set as current if status is active
            if (data.status === 'active') {
              const sensor = {
                id: doc.id,
                serialNumber: data.serialNumber,
                startedAt: data.startedAt.toDate(),
                expiresAt: data.expiresAt.toDate(),
                manufacturer: data.manufacturer,
                model: data.model,
                status: data.status,
                batteryLevel: data.batteryLevel,
                lastReading: data.lastReading,
                lastReadingTime: data.lastReadingTime?.toDate(),
              };
              
              setCurrentSensor(sensor);
              
              // Cache the sensor data for offline use
              try {
                // Convert Date objects to strings for storage
                const sensorToCache = {
                  ...sensor,
                  startedAt: sensor.startedAt.toISOString(),
                  expiresAt: sensor.expiresAt.toISOString(),
                  lastReadingTime: sensor.lastReadingTime ? sensor.lastReadingTime.toISOString() : null
                };
                
                await AsyncStorage.setItem(
                  `${SENSOR_CACHE_KEY}_${user.uid}`,
                  JSON.stringify(sensorToCache)
                );
                console.log('[StartSensorScreen] Sensor data cached for offline use');
              } catch (cacheError) {
                console.error('[StartSensorScreen] Error caching sensor data:', cacheError);
              }
              
              console.log(`[StartSensorScreen] Set active sensor with serial: ${data.serialNumber}`);
            } else {
              console.log(`[StartSensorScreen] Found sensor with status ${data.status}, not setting as current`);
              // Clear the cache if there's no active sensor
              try {
                await AsyncStorage.removeItem(`${SENSOR_CACHE_KEY}_${user.uid}`);
              } catch (clearError) {
                console.error('[StartSensorScreen] Error clearing sensor cache:', clearError);
              }
            }
          } else {
            console.log('[StartSensorScreen] No sensor documents found for user');
            // No active sensor, clear the cache
            try {
              await AsyncStorage.removeItem(`${SENSOR_CACHE_KEY}_${user.uid}`);
            } catch (clearError) {
              console.error('[StartSensorScreen] Error clearing sensor cache:', clearError);
            }
            // No active sensor, but that's okay - just set to null
            setCurrentSensor(null);
          }
        } else {
          console.log('[StartSensorScreen] Device is offline, using cached sensor data only');
        }
      } catch (error: any) {
        console.error('[StartSensorScreen] Error fetching current sensor:', error);
        // Handle Firebase permission errors specifically
        if (error.toString().includes('Missing or insufficient permissions')) {
          console.log('[StartSensorScreen] Permission error when fetching sensors - likely no sensors collection yet');
          // This is normal for new users with no sensors yet
          setCurrentSensor(null);
        } else {
          // Only show alert for unexpected errors
          Alert.alert('Error', 'Failed to fetch current sensor information');
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchCurrentSensor();
  }, [user]);
  
  // Initialize NFC service and check availability
  useEffect(() => {
    let mounted = true;
    
    const initializeNfc = async () => {
      try {
        console.log('[StartSensorScreen] Starting NFC initialization...');
        await nfcService.initialize();
        console.log('[StartSensorScreen] NFC initialization completed');
        
        // Initial NFC availability check
        if (mounted) {
          const isAvailable = await SensorNfcService.isNfcAvailable();
          console.log(`[StartSensorScreen] NFC availability check result: ${isAvailable}`);
          setNfcAvailable(isAvailable);
        }
        
        // Explicitly disable foreground dispatch to prevent auto-scanning
        try {
          const nfcCoreService = NfcService.getInstance();
          await nfcCoreService.disableForegroundDispatch();
          console.log('[StartSensorScreen] Disabled NFC foreground dispatch on initialization');
        } catch (dispatchError) {
          console.error('[StartSensorScreen] Error disabling foreground dispatch on init:', dispatchError);
        }
      } catch (error) {
        console.error('[StartSensorScreen] Failed to initialize NFC:', error);
        if (mounted) {
          setNfcAvailable(false);
        }
      }
    };
    
    // Start initialization
    initializeNfc();
    
    // Setup app state event listeners for NFC status checks instead of interval
    const handleAppStateChange = async (nextAppState: string) => {
      // Only check NFC when app comes to foreground
      if (nextAppState === 'active' && mounted) {
        try {
          const isAvailable = await SensorNfcService.isNfcAvailable();
          if (nfcAvailable !== isAvailable) {
            console.log(`[StartSensorScreen] NFC availability changed to: ${isAvailable}`);
            setNfcAvailable(isAvailable);
          }
          
          // When coming back to foreground, ensure foreground dispatch is disabled
          // This prevents auto-scanning after returning from settings
          if (isAvailable) {
            try {
              const nfcCoreService = NfcService.getInstance();
              await nfcCoreService.disableForegroundDispatch();
              console.log('[StartSensorScreen] Disabled NFC foreground dispatch after app resume');
            } catch (dispatchError) {
              console.error('[StartSensorScreen] Error disabling foreground dispatch on resume:', dispatchError);
            }
          }
        } catch (error) {
          console.error('[StartSensorScreen] Error during NFC availability check:', error);
        }
      }
    };
    
    // Add app state change listener
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    
    // Force an NFC cleanup on mount just to be safe
    const performInitialCleanup = async () => {
      try {
        console.log('[StartSensorScreen] Performing initial NFC cleanup');
        await NfcManager.cancelTechnologyRequest().catch(() => {});
        
        // Explicitly disable foreground dispatch on mount
        const nfcCoreService = NfcService.getInstance();
        if (nfcCoreService) {
          await nfcCoreService.disableForegroundDispatch();
        }
      } catch (error) {
        console.log('[StartSensorScreen] Initial cleanup error (can be ignored):', error);
      }
    };
    
    performInitialCleanup();
    
    return () => {
      // Mark component as unmounted
      mounted = false;
      
      // Remove app state subscription
      appStateSubscription.remove();
      
      // Execute stored cleanup function if exists
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch (error) {
          console.error('[StartSensorScreen] Error during stored cleanup execution:', error);
        }
        cleanupRef.current = null;
      }
      
      // Always perform a final NFC cleanup
      try {
        console.log('[StartSensorScreen] Cleaning up NFC resources...');
        nfcService.cleanup();
        NfcManager.cancelTechnologyRequest().catch(() => {});
        
        // Explicitly disable foreground dispatch on unmount
        const nfcCoreService = NfcService.getInstance();
        if (nfcCoreService) {
          nfcCoreService.disableForegroundDispatch().catch(() => {});
        }
      } catch (error) {
        console.error('[StartSensorScreen] Error during NFC cleanup:', error);
      }
    };
  }, []);
  
  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  // Calculate remaining time for sensor
  const getRemainingTime = (expiresAt: Date) => {
    const now = new Date();
    const diffTime = expiresAt.getTime() - now.getTime();
    
    if (diffTime <= 0) {
      return 'Expired';
    }
    
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}, ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  };
  
  // Safe NFC cleanup function
  const ensureNfcCleanup = async () => {
    try {
      console.log('[StartSensorScreen] Ensuring NFC resources are cleaned up');
      await NfcManager.cancelTechnologyRequest().catch(() => {});
      nfcOperationInProgress.current = false;
    } catch (error) {
      console.error('[StartSensorScreen] Error during NFC cleanup:', error);
      // Still mark as not in progress even if cleanup fails
      nfcOperationInProgress.current = false;
    }
  };
  
  // Add method to detect sensor type
  const detectSensorType = async () => {
    try {
      setScanning(true);
      
      // Get core NFC service and enable foreground dispatch for scanning
      const nfcCoreService = NfcService.getInstance();
      try {
        console.log('[StartSensorScreen] Enabling NFC foreground dispatch for sensor type detection...');
        await nfcCoreService.enableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error enabling foreground dispatch for detection:', dispatchError);
        // Continue anyway
      }
      
      const detectedType = await sensorDetectionService.detectSensorType();
      setSensorType(detectedType);
      
      // Update monitoring service with detected sensor type
      monitoringService.setSensorType(detectedType);
      
      if (detectedType === SensorType.LIBRE) {
        // Get additional sensor info for Libre sensors
        const sensorInfo = await libreService.readSensorInfo();
        setLibreSensorInfo(sensorInfo);
      }
      
      setScanning(false);
      
      // Disable foreground dispatch after detection
      try {
        console.log('[StartSensorScreen] Disabling NFC foreground dispatch after detection...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch after detection:', dispatchError);
      }
      
      return detectedType;
    } catch (error) {
      console.error('[StartSensorScreen] Error detecting sensor type:', error);
      
      // Disable foreground dispatch on error
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Disabling NFC foreground dispatch after detection error...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch after error:', dispatchError);
      }
      
      setScanning(false);
      Alert.alert('Error', 'Failed to detect sensor type');
      return SensorType.UNKNOWN;
    }
  };
  
  // Modify handleScan to handle different sensor types
  const handleScan = async () => {
    // Prevent multiple scan attempts
    if (scanning || processing) {
      return;
    }
    
    try {
      // Check if NFC is available before proceeding
      const isNfcAvailable = await SensorNfcService.isNfcAvailable();
      
      if (!isNfcAvailable) {
        // Prompt the user to enable NFC and offer to redirect to settings
        Alert.alert(
          'NFC Required',
          'NFC is required to scan sensors but it appears to be disabled on your device.',
          [
            {
              text: 'Cancel',
              style: 'cancel'
            },
            {
              text: 'Open NFC Settings',
              onPress: async () => {
                try {
                  await SensorNfcService.openNfcSettings();
                } catch (error) {
                  console.error('[StartSensorScreen] Error opening NFC settings:', error);
                  Alert.alert('Error', 'Could not open NFC settings. Please enable NFC manually in your device settings.');
                }
              }
            }
          ]
        );
        return;
      }
      
      setScanning(true);
      setShowScanGuide(true); // Keep showing the scan guide
      nfcOperationInProgress.current = true;
      
      // Get core NFC service and enable foreground dispatch for scanning
      const nfcCoreService = NfcService.getInstance();
      try {
        console.log('[StartSensorScreen] Enabling NFC foreground dispatch for scanning...');
        await nfcCoreService.enableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error enabling foreground dispatch:', dispatchError);
        // Continue anyway
      }
      
      // Create a promise that will be rejected after 20 seconds
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT'));
        }, 20000); // 20 second timeout - gives more time to read sensor
      });
      
      try {
        // Detect sensor type with extended timeout
        const sensorDetectionPromise = sensorDetectionService.detectSensorType();
        const detectedType = await Promise.race([sensorDetectionPromise, timeoutPromise]) as SensorType;
        
        // Hide scan guide as soon as sensor is detected
        setShowScanGuide(false);
        setSensorType(detectedType);
        
        // Update monitoring service with detected sensor type
        monitoringService.setSensorType(detectedType);
        
        if (detectedType === SensorType.LIBRE) {
          // Handle FreeStyle Libre sensor with extended timeout
          try {
            const sensorInfoPromise = libreService.readSensorInfo();
            const sensorInfo = await Promise.race([sensorInfoPromise, timeoutPromise]) as LibreSensorInfo;
            
            if (sensorInfo) {
              setLibreSensorInfo(sensorInfo);
              
              // Activate Libre sensor
              await activateLibreSensor(
                sensorInfo.serialNumber,
                sensorInfo.sensorType,
                'Abbott'
              );
            } else {
              Alert.alert('Error', 'Could not read FreeStyle Libre sensor information. Try again and hold your phone still during the entire process.');
            }
          } catch (libreError: unknown) {
            // Specific error handling for Libre sensors
            if ((libreError as Error).message === 'TIMEOUT') {
              Alert.alert(
                'Sensor Read Timeout', 
                'Reading the FreeStyle Libre sensor took too long. Make sure you hold your phone still during the entire scan process.'
              );
            } else {
              throw libreError; // Re-throw for outer catch
            }
          }
        } else if (detectedType === SensorType.RF430) {
          // Continue with existing RF430 sensor handling
          const sensorInfo = await nfcService.readSensorInfo();
          if (!sensorInfo) {
            throw new Error('Failed to read sensor information');
          }
          
          // Activate RF430 sensor (existing code)
          await activateSensor(
            sensorInfo.serialNumber || 'unknown',
            sensorInfo.sensorType || 'RF430FRL15xH',
            'Custom'
          );
        } else {
          Alert.alert('Unknown Sensor', 'Could not identify sensor type');
        }
      } catch (scanError: unknown) {
        // Handle timeout or other errors during sensor detection
        if ((scanError as Error).message === 'TIMEOUT') {
          Alert.alert(
            'Scan Timeout', 
            'The scan took too long to complete. Please make sure your sensor is near your phone and try again.'
          );
        } else {
          // Re-throw for outer catch block
          throw scanError;
        }
      }
    } catch (error) {
      console.error('[StartSensorScreen] Error scanning sensor:', error);
      
      let errorMessage = 'Failed to scan sensor';
      
      if (error instanceof Error) {
        // Provide more specific error messages
        if (error.message.includes('TAG_NOT_FOUND')) {
          errorMessage = 'No sensor found. Please try again and make sure the sensor is close to your device.';
        } else if (error.message.includes('TIMEOUT')) {
          errorMessage = 'Scan timed out. Please try again and hold your phone still during the scan.';
        } else if (error.message.includes('CANCELLED')) {
          errorMessage = 'Scan was cancelled.';
        } else if (error.message.includes('you should requestTagEvent first')) {
          errorMessage = 'NFC scan issue. Please try again and keep your phone still near the sensor for the entire scan process.';
        } else if (error.message.includes('NFC_NOT_ENABLED') || error.message.includes('NFC is not enabled')) {
          // Handle case when NFC was initially enabled but disabled during the process
          Alert.alert(
            'NFC Disabled',
            'NFC appears to have been disabled. Do you want to open NFC settings?',
            [
              {
                text: 'Cancel',
                style: 'cancel'
              },
              {
                text: 'Open Settings',
                onPress: () => SensorNfcService.openNfcSettings()
              }
            ]
          );
          return;
        } else {
          errorMessage = `Error: ${error.message}`;
        }
      }
      
      Alert.alert('Scan Error', errorMessage);
    } finally {
      setScanning(false);
      setShowScanGuide(false); // Ensure scan guide is hidden
      
      // Explicitly disable foreground dispatch after scanning
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Disabling NFC foreground dispatch after scanning...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch:', dispatchError);
      }
      
      await ensureNfcCleanup();
      nfcOperationInProgress.current = false;
    }
  };
  
  // Handle cancel scanning
  const handleCancelScan = () => {
    Alert.alert(
      'Cancel Scan',
      'Are you sure you want to cancel?',
      [
        {
          text: 'No',
          style: 'cancel'
        },
        {
          text: 'Yes',
          onPress: async () => {
            console.log('[StartSensorScreen] User confirmed scan cancellation');
            setShowScanGuide(false);
            setScanning(false);
            await ensureNfcCleanup();
          }
        }
      ]
    );
  };
  
  // Handle scan guide timeout
  const handleScanTimeout = () => {
    setShowScanGuide(false);
    Alert.alert(
      'Scan Timeout',
      'Unable to detect a sensor. Make sure your sensor is within range and try again.',
      [{ text: 'OK' }]
    );
    ensureNfcCleanup();
    setScanning(false);
  };
  
  // Update activateSensor to ensure readings are saved correctly
  const activateSensor = async (serialNumber: string, manufacturer: string, model: string) => {
    if (!user) return;
    
    setScanning(false);
    setProcessing(true);
    
    try {
      console.log('[StartSensorScreen] Starting sensor activation for:', serialNumber);
      
      // If there's an active sensor, mark it as removed
      if (currentSensor?.id) {
        try {
          await deactivateCurrentSensor();
          console.log('[StartSensorScreen] Previous sensor deactivated successfully');
        } catch (deactivateError) {
          console.warn('[StartSensorScreen] Error deactivating current sensor, continuing with new sensor:', deactivateError);
          // Don't let this error stop the activation of a new sensor
        }
      }
      
      // Calculate expiration date (14 days from now for most CGM sensors)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      
      // Prepare sensor object with all necessary fields
      const newSensor = {
        serialNumber,
        startedAt: now,
        expiresAt,
        manufacturer,
        model,
        status: 'active' as const,
        createdAt: serverTimestamp(),
        lastReading: sensorTestResult?.reading || null,
        lastReadingTime: sensorTestResult?.success ? now : null,
        batteryLevel: 100, // Assume full battery for new sensor
      };
      
      console.log('[StartSensorScreen] Adding sensor to user collection');
      
      // Add new sensor to Firestore - user specific collection
      const sensorsRef = collection(db, 'users', user.uid, 'sensors');
      const docRef = await addDoc(sensorsRef, newSensor);
      console.log('[StartSensorScreen] Sensor added to user collection successfully with ID:', docRef.id);
      
      // Prepare main collection sensor object
      const mainSensorData = {
        serialNumber,
        userId: user.uid,
        activationDate: now,
        expirationDate: expiresAt,
        manufacturer,
        model,
        status: 'active' as const,
        lastScanTime: now,
        batteryLevel: 100,
        lastReading: sensorTestResult?.reading || null,
        lastReadingTime: sensorTestResult?.success ? now : null,
        isExpired: false,
        isExpiringSoon: false,
        hasLowBattery: false,
      };
      
      try {
        // Also store sensor information in the main sensors collection
        console.log('[StartSensorScreen] Adding sensor to main sensors collection');
        const mainSensorRef = doc(db, 'sensors', serialNumber);
        await setDoc(mainSensorRef, mainSensorData);
        console.log('[StartSensorScreen] Sensor added to main collection successfully');
      } catch (mainSensorError) {
        // If there's an error with the main collection, log it but don't fail the whole activation
        console.error('[StartSensorScreen] Error adding to main sensors collection:', mainSensorError);
        // We can still proceed since the user-specific sensor was added
      }
      
      // Create the sensor object for state and caching
      const sensorForState = {
        id: docRef.id,
        serialNumber,
        startedAt: now,
        expiresAt,
        manufacturer,
        model,
        status: 'active' as const,
        lastReading: sensorTestResult?.reading || null,
        lastReadingTime: sensorTestResult?.success ? now : null,
        batteryLevel: 100,
      };
      
      // Update state
      setCurrentSensor(sensorForState);
      
      // Cache the sensor data for offline use
      try {
        // Convert Date objects to strings for storage
        const sensorToCache = {
          ...sensorForState,
          startedAt: sensorForState.startedAt.toISOString(),
          expiresAt: sensorForState.expiresAt.toISOString(),
          lastReadingTime: sensorForState.lastReadingTime ? sensorForState.lastReadingTime.toISOString() : null
        };
        
        await AsyncStorage.setItem(
          `${SENSOR_CACHE_KEY}_${user.uid}`,
          JSON.stringify(sensorToCache)
        );
        console.log('[StartSensorScreen] New sensor data cached for offline use');
      } catch (cacheError) {
        console.error('[StartSensorScreen] Error caching new sensor data:', cacheError);
      }
      
      try {
        // Update sensor status service
        await sensorStatusService.activateSensor(serialNumber, user.uid);
        console.log('[StartSensorScreen] Sensor status service updated');
      } catch (statusError) {
        // If status service fails, it's not critical to the activation
        console.warn('[StartSensorScreen] Error updating sensor status service:', statusError);
      }
      
      // Success notification
      Alert.alert(
        'Sensor Activated',
        'Your new sensor has been successfully activated. It will expire in 14 days.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate to home screen to see the reading
              navigation.navigate('MainApp');
            }
          }
        ]
      );
    } catch (error) {
      console.error('[StartSensorScreen] Error activating sensor:', error);
      Alert.alert('Error', 'Failed to activate the sensor. Please try again.');
    } finally {
      setProcessing(false);
    }
  };
  
  // Deactivate the current sensor
  const deactivateCurrentSensor = async () => {
    if (!user || !currentSensor?.id) return;
    
    try {
      // Update the sensor document in Firestore to mark as removed
      const sensorDocRef = doc(db, 'users', user.uid, 'sensors', currentSensor.id);
      
      // Update instead of delete to keep the history
      await updateDoc(sensorDocRef, {
        status: 'removed',
        removedAt: new Date(),
      });
      
      // Also update the main sensors collection if it exists
      if (currentSensor.serialNumber) {
        try {
          const mainSensorRef = doc(db, 'sensors', currentSensor.serialNumber);
          
          // Check if document exists before updating
          const mainSensorDoc = await getDocs(query(
            collection(db, 'sensors'),
            where('serialNumber', '==', currentSensor.serialNumber),
            limit(1)
          ));
          
          if (!mainSensorDoc.empty) {
            // Document exists, update it
            await updateDoc(mainSensorRef, {
              status: 'removed',
              isConnected: false,
              removedAt: new Date(),
            });
          } else {
            console.log('[StartSensorScreen] Main sensor document not found, skipping update');
          }
        } catch (mainSensorError) {
          // Just log the error but don't fail the entire operation
          console.error('[StartSensorScreen] Error updating main sensor doc:', mainSensorError);
        }
      }
      
      // Clear cache since sensor is now inactive
      try {
        await AsyncStorage.removeItem(`${SENSOR_CACHE_KEY}_${user.uid}`);
        console.log('[StartSensorScreen] Sensor cache cleared after deactivation');
      } catch (cacheError) {
        console.error('[StartSensorScreen] Error clearing sensor cache:', cacheError);
      }
      
      // Clear current sensor state
      setCurrentSensor(null);
    } catch (error) {
      console.error('Error deactivating sensor:', error);
      throw error; // Let the caller handle this error
    }
  };
  
  // Handle manual deactivation by user
  const handleDeactivate = () => {
    if (!currentSensor) return;
    
    Alert.alert(
      'Deactivate Sensor',
      'Are you sure you want to deactivate the current sensor? This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessing(true);
              await deactivateCurrentSensor();
              Alert.alert('Success', 'The sensor has been deactivated.');
            } catch (error) {
              console.error('Error deactivating sensor:', error);
              Alert.alert('Error', 'Failed to deactivate the sensor. Please try again.');
            } finally {
              setProcessing(false);
            }
          }
        }
      ]
    );
  };
  
  // Add a function to run the diagnostic test
  const runDiagnosticTest = async () => {
    // Don't run if another operation is in progress
    if (scanning || processing || runningDiagnostic) {
      return;
    }
    
    try {
      // Check if NFC is available before proceeding
      const isNfcAvailable = await SensorNfcService.isNfcAvailable();
      
      if (!isNfcAvailable) {
        // Prompt the user to enable NFC and offer to redirect to settings
        Alert.alert(
          'NFC Required',
          'NFC is required to test sensor communication but it appears to be disabled on your device.',
          [
            {
              text: 'Cancel',
              style: 'cancel'
            },
            {
              text: 'Open NFC Settings',
              onPress: async () => {
                try {
                  await SensorNfcService.openNfcSettings();
                } catch (error) {
                  console.error('[StartSensorScreen] Error opening NFC settings:', error);
                  Alert.alert('Error', 'Could not open NFC settings. Please enable NFC manually in your device settings.');
                }
              }
            }
          ]
        );
        return;
      }
      
      setRunningDiagnostic(true);
      setDiagnosticResult(null);
      
      // Get core NFC service and enable foreground dispatch for scanning
      const nfcCoreService = NfcService.getInstance();
      try {
        console.log('[StartSensorScreen] Enabling NFC foreground dispatch for diagnostic...');
        await nfcCoreService.enableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error enabling foreground dispatch for diagnostic:', dispatchError);
        // Continue anyway
      }
      
      try {
        // First check sensor type if we need to
        let currentSensorType = sensorType;
        if (currentSensorType === SensorType.UNKNOWN) {
          console.log('[StartSensorScreen] Detecting sensor type for diagnostic test...');
          setShowScanGuide(true);
          currentSensorType = await sensorDetectionService.detectSensorType();
          setSensorType(currentSensorType);
          setShowScanGuide(false);
        }
        
        console.log(`[StartSensorScreen] Running diagnostic with sensor type: ${currentSensorType}`);
        
        if (currentSensorType === SensorType.LIBRE) {
          // For Libre sensors
          setShowScanGuide(true);
          // Use detectLibreSensor which is available in FreeStyleLibreService
          const success = await libreService.detectLibreSensor();
          setShowScanGuide(false);
          
          if (success) {
            setDiagnosticResult({
              success: true,
              message: 'Successfully communicated with your FreeStyle Libre sensor!'
            });
          } else {
            setDiagnosticResult({
              success: false,
              message: 'Could not establish communication with the FreeStyle Libre sensor. Make sure it is properly applied and try again.'
            });
          }
        } else {
          // For RF430 sensors
          setShowScanGuide(true);
          const success = await nfcService.diagnosticTest();
          setShowScanGuide(false);
          
          if (success) {
            setDiagnosticResult({
              success: true,
              message: 'Successfully communicated with your sensor!'
            });
          } else {
            setDiagnosticResult({
              success: false,
              message: 'Could not establish communication with the sensor. Make sure it is properly applied and try again.'
            });
          }
        }
      } catch (error) {
        console.error('[StartSensorScreen] Diagnostic test error:', error);
        setDiagnosticResult({
          success: false,
          message: `Diagnostic failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      } finally {
        // Ensure scan guide is hidden if still visible
        setShowScanGuide(false);
        
        // Explicitly disable foreground dispatch after diagnostic
        try {
          const nfcCoreService = NfcService.getInstance();
          console.log('[StartSensorScreen] Disabling NFC foreground dispatch after diagnostic...');
          await nfcCoreService.disableForegroundDispatch();
        } catch (dispatchError) {
          console.error('[StartSensorScreen] Error disabling foreground dispatch after diagnostic:', dispatchError);
        }
      }
    } catch (error) {
      console.error('[StartSensorScreen] Error in diagnostic test:', error);
      
      if (error instanceof Error && (error.message.includes('NFC_NOT_ENABLED') || error.message.includes('NFC is not enabled'))) {
        // Handle case when NFC was initially enabled but disabled during the process
        Alert.alert(
          'NFC Disabled',
          'NFC appears to have been disabled. Do you want to open NFC settings?',
          [
            {
              text: 'Cancel',
              style: 'cancel'
            },
            {
              text: 'Open Settings',
              onPress: () => SensorNfcService.openNfcSettings()
            }
          ]
        );
      } else {
        setDiagnosticResult({
          success: false,
          message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    } finally {
      setRunningDiagnostic(false);
      await ensureNfcCleanup();
    }
  };
  
  // Add method to activate Libre sensor
  const activateLibreSensor = async (serialNumber: string, model: string, manufacturer: string) => {
    try {
      setProcessing(true);
      
      // Calculate expiration date (14 days from now for Libre sensors)
      const startedAt = new Date();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);
      
      // Create sensor record in Firestore
      const sensorData = {
        serialNumber,
        startedAt,
        expiresAt,
        manufacturer,
        model,
        status: 'active' as const,
        batteryLevel: 100, // Libre doesn't report battery level
        lastReading: null,
        lastReadingTime: null
      };
      
      // Store sensor in Firestore (using existing code)
      if (user) {
        try {
          console.log(`[StartSensorScreen] Storing FreeStyle Libre sensor data for user: ${user.uid}`);
          const sensorsRef = collection(db, 'users', user.uid, 'sensors');
          const docRef = await addDoc(sensorsRef, {
            ...sensorData,
            startedAt: serverTimestamp(),
            expiresAt: new Date(expiresAt),
          });
          
          // Create the sensor object for state and caching
          const sensorForState = {
            id: docRef.id,
            serialNumber,
            startedAt,
            expiresAt,
            manufacturer,
            model,
            status: 'active' as const,
            batteryLevel: 100,
            lastReading: null,
            lastReadingTime: null
          };
          
          // Update state
          setCurrentSensor(sensorForState);
          
          // Cache the sensor data for offline use
          try {
            // Convert Date objects to strings for storage
            const sensorToCache = {
              ...sensorForState,
              startedAt: sensorForState.startedAt.toISOString(),
              expiresAt: sensorForState.expiresAt.toISOString(),
              lastReadingTime: null
            };
            
            await AsyncStorage.setItem(
              `${SENSOR_CACHE_KEY}_${user.uid}`,
              JSON.stringify(sensorToCache)
            );
            console.log('[StartSensorScreen] New Libre sensor data cached for offline use');
          } catch (cacheError) {
            console.error('[StartSensorScreen] Error caching new Libre sensor data:', cacheError);
          }
          
          console.log('[StartSensorScreen] FreeStyle Libre sensor data stored successfully');
        } catch (error) {
          console.error('[StartSensorScreen] Error storing sensor data:', error);
          throw new Error('Failed to store sensor data');
        }
      }
      
      // Test reading - this will handle enabling/disabling foreground dispatch internally
      const readingSuccess = await verifyLibreSensor();
      
      // Make sure foreground dispatch is disabled regardless of verifyLibreSensor's internal handling
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Ensuring NFC foreground dispatch is disabled after activation...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch after activation:', dispatchError);
      }
      
      // Success
      Alert.alert('Success', 'FreeStyle Libre sensor activated successfully', [
        { 
          text: 'OK', 
          onPress: () => {
            // Navigate directly to the Home screen to show the new reading
            navigation.navigate('MainApp');
          }
        }
      ]);
    } catch (error) {
      console.error('[StartSensorScreen] Error activating Libre sensor:', error);
      
      // Make sure foreground dispatch is disabled on error
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Ensuring NFC foreground dispatch is disabled after activation error...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch after error:', dispatchError);
      }
      
      Alert.alert('Error', 'Failed to activate FreeStyle Libre sensor');
    } finally {
      setProcessing(false);
    }
  };
  
  // Update verifyLibreSensor to reliably save the first reading
  const verifyLibreSensor = async () => {
    try {
      setVerifyingSensor(true);
      
      // Enable foreground dispatch explicitly for verification
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Enabling NFC foreground dispatch for sensor verification...');
        await nfcCoreService.enableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error enabling foreground dispatch for verification:', dispatchError);
        // Continue anyway
      }
      
      // Take a test reading
      const reading = await libreService.readGlucoseData();
      
      // Disable foreground dispatch after reading
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Disabling NFC foreground dispatch after verification...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch after verification:', dispatchError);
      }
      
      // Save the reading to Firebase if user is logged in
      if (user) {
        try {
          console.log(`[StartSensorScreen] Saving initial Libre sensor reading (${reading.value} mg/dL) to Firebase`);
          
          // Make sure our reading has a timestamp that's guaranteed to be unique
          // This helps avoid duplicate detection issues
          const uniqueTimestamp = new Date();
          const uniqueReading = {
            ...reading,
            timestamp: uniqueTimestamp,
            isSensorActivationReading: true // Special flag to bypass duplicate detection
          };
          
          const readingId = await MeasurementService.addReading(user.uid, uniqueReading);
          
          // Create full reading with ID
          const fullReading = {
            ...reading,
            id: readingId
          };
          
          // Update the monitoring service's last reading
          monitoringService.setLastReading(fullReading);
          
          console.log('[StartSensorScreen] Initial reading saved successfully with ID:', readingId);
        } catch (error) {
          console.error('[StartSensorScreen] Error saving initial reading:', error);
          // Continue anyway - we still consider sensor verification successful
        }
      }
      
      setSensorTestResult({
        success: true,
        reading: reading.value
      });
      
      return true;
    } catch (error) {
      console.error('[StartSensorScreen] Error verifying Libre sensor:', error);
      
      // Disable foreground dispatch on error
      try {
        const nfcCoreService = NfcService.getInstance();
        console.log('[StartSensorScreen] Disabling NFC foreground dispatch after verification error...');
        await nfcCoreService.disableForegroundDispatch();
      } catch (dispatchError) {
        console.error('[StartSensorScreen] Error disabling foreground dispatch after error:', dispatchError);
      }
      
      setSensorTestResult({
        success: false,
        reading: null,
        error: 'Failed to read glucose data from sensor'
      });
      return false;
    } finally {
      setVerifyingSensor(false);
    }
  };
  
  // Add UI component for sensor type selection
  const renderSensorTypeSelection = () => {
    return (
      <View style={styles.sensorTypeContainer}>
        <Text style={styles.sectionTitle}>Sensor Type</Text>
        <View style={styles.sensorTypeButtons}>
          <TouchableOpacity
            style={[styles.sensorTypeButton, sensorType === SensorType.RF430 && styles.selectedButton]}
            onPress={() => {
              setSensorType(SensorType.RF430);
              monitoringService.setSensorType(SensorType.RF430);
            }}
          >
            <Text style={[styles.buttonText, sensorType === SensorType.RF430 && styles.selectedButtonText]}>Custom RF430</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sensorTypeButton, sensorType === SensorType.LIBRE && styles.selectedButton]}
            onPress={() => {
              setSensorType(SensorType.LIBRE);
              monitoringService.setSensorType(SensorType.LIBRE);
            }}
          >
            <Text style={[styles.buttonText, sensorType === SensorType.LIBRE && styles.selectedButtonText]}>FreeStyle Libre</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  
  // Add UI component for Libre sensor info
  const renderLibreSensorInfo = () => {
    if (sensorType !== SensorType.LIBRE || !libreSensorInfo) return null;
    
    return (
      <View style={styles.sensorInfoContainer}>
        <Text style={styles.sectionTitle}>FreeStyle Libre Sensor</Text>
        <Text style={styles.sensorInfoText}>Type: {libreSensorInfo.sensorType}</Text>
        <Text style={styles.sensorInfoText}>Serial: {libreSensorInfo.serialNumber}</Text>
        <Text style={styles.sensorInfoText}>
          Remaining Life: {Math.floor(libreSensorInfo.remainingLifeMinutes / 60 / 24)} days, {Math.floor((libreSensorInfo.remainingLifeMinutes / 60) % 24)} hours
        </Text>
      </View>
    );
  };
  
  // Update the NfcScanGuide message based on sensor type
  const getScanMessage = () => {
    return `Hold your phone near the ${sensorType === SensorType.LIBRE ? 'FreeStyle Libre' : 'glucose'} sensor`;
  };
  
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4361EE" />
          <Text style={styles.loadingText}>Loading sensor information...</Text>
        </View>
      </SafeAreaView>
    );
  }
  
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Only show sensor type selection when there's no active sensor */}
        {!currentSensor && renderSensorTypeSelection()}
        
        {/* Only show Libre sensor info when there's no active sensor */}
        {!currentSensor && renderLibreSensorInfo()}
        
        {/* Current Sensor Info */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Current Sensor</Text>
          
          {currentSensor ? (
            <View style={styles.currentSensorContainer}>
              <View style={styles.sensorIconContainer}>
                <Ionicons name="radio-outline" size={36} color="#4361EE" />
              </View>
              
              <View style={styles.sensorDetails}>
                <Text style={styles.sensorName}>{currentSensor.model}</Text>
                <Text style={styles.sensorSerial}>SN: {currentSensor.serialNumber}</Text>
                <Text style={styles.sensorTimestamp}>
                  Activated: {formatDate(currentSensor.startedAt)}
                </Text>
                <Text style={styles.sensorTimestamp}>
                  Expires: {formatDate(currentSensor.expiresAt)}
                </Text>
                <Text style={styles.sensorStatus}>
                  Remaining: {getRemainingTime(currentSensor.expiresAt)}
                </Text>
                
                <TouchableOpacity
                  style={styles.deactivateButton}
                  onPress={handleDeactivate}
                  disabled={processing}
                >
                  {processing ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={styles.deactivateButtonText}>Deactivate Sensor</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.noSensorContainer}>
              <Ionicons name="radio-outline" size={64} color="#ccc" />
              <Text style={styles.noSensorText}>No Active Sensor</Text>
              <Text style={styles.noSensorSubtext}>
                You don't have an active sensor. Scan a new sensor to start glucose monitoring.
              </Text>
            </View>
          )}
        </View>
        
        {/* Scan Instructions - Only show if no sensor is active */}
        {!currentSensor && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>How to Apply Your Sensor</Text>
            
            <View style={styles.instructionsContainer}>
              <Text style={styles.instructionStep}>1. Clean the back of your arm with alcohol</Text>
              <Text style={styles.instructionStep}>2. Remove the adhesive backing from the sensor</Text>
              <Text style={styles.instructionStep}>3. Apply the sensor to the back of your arm</Text>
              <Text style={styles.instructionStep}>4. Press the scan button to activate the sensor</Text>
            </View>
            
            <TouchableOpacity
              style={styles.scanButton}
              onPress={handleScan}
              disabled={scanning || processing || runningDiagnostic}
            >
              {scanning ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Ionicons name="scan-outline" size={24} color="white" style={styles.scanIcon} />
                  <Text style={styles.scanButtonText}>Scan New Sensor</Text>
                </>
              )}
            </TouchableOpacity>
            
            {/* Diagnostic Test Button */}
            <TouchableOpacity
              style={[styles.diagnosticButton, {marginTop: 15}]}
              onPress={runDiagnosticTest}
              disabled={scanning || processing || runningDiagnostic}
            >
              {runningDiagnostic ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Ionicons name="flash-outline" size={24} color="white" style={styles.scanIcon} />
                  <Text style={styles.scanButtonText}>Test Sensor Communication</Text>
                </>
              )}
            </TouchableOpacity>
            
            {/* Diagnostic Result */}
            {diagnosticResult && (
              <View style={[
                styles.diagnosticResult, 
                {backgroundColor: diagnosticResult.success ? '#e0f7e6' : '#ffebee'}
              ]}>
                <Ionicons 
                  name={diagnosticResult.success ? 'checkmark-circle-outline' : 'alert-circle-outline'} 
                  size={24} 
                  color={diagnosticResult.success ? '#4caf50' : '#f44336'} 
                  style={{marginRight: 10}}
                />
                <Text style={{
                  color: diagnosticResult.success ? '#2e7d32' : '#c62828',
                  flex: 1
                }}>
                  {diagnosticResult.message}
                </Text>
              </View>
            )}
          </View>
        )}
        
        {/* Sensor Information */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Sensor Information</Text>
          
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Sensors last for 14 days</Text>
            <Text style={styles.infoDescription}>
              Your CGM sensor provides continuous glucose readings for 14 days before it needs to be replaced.
            </Text>
          </View>
          
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Water Resistant</Text>
            <Text style={styles.infoDescription}>
              Your sensor is water resistant for up to 30 minutes at a depth of 1 meter. You can shower, bathe, or swim with your sensor.
            </Text>
          </View>
          
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Need Help?</Text>
            <Text style={styles.infoDescription}>
              If you have questions about your sensor or need assistance, please contact our support team.
            </Text>
          </View>
        </View>
        
        {/* Spacing at the bottom */}
        <View style={{ height: 40 }} />
      </ScrollView>
      
      {/* NFC Scan Guide with updated message */}
      <NfcScanGuide
        visible={showScanGuide}
        onTimeout={handleScanTimeout}
        onCancel={handleCancelScan}
        message={getScanMessage()}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
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
  headerContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  sectionContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginHorizontal: 15,
    marginTop: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  currentSensorContainer: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sensorIconContainer: {
    backgroundColor: '#e0e7ff',
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  sensorDetails: {
    flex: 1,
  },
  sensorName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  sensorSerial: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  sensorTimestamp: {
    fontSize: 14,
    color: '#666',
    marginBottom: 3,
  },
  sensorStatus: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4361EE',
    marginBottom: 10,
  },
  deactivateButton: {
    backgroundColor: '#F72585',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 5,
  },
  deactivateButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  noSensorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f0f3ff',
    borderRadius: 10,
  },
  noSensorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 15,
    marginBottom: 5,
  },
  noSensorSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 5,
  },
  instructionsContainer: {
    marginBottom: 20,
  },
  instructionStep: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#4361EE',
  },
  scanButton: {
    backgroundColor: '#4CC9F0',
    flexDirection: 'row',
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  scanIcon: {
    marginRight: 10,
  },
  scanButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: '#f0f3ff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  infoDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  diagnosticButton: {
    backgroundColor: '#FF9500',
    flexDirection: 'row',
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  diagnosticResult: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginTop: 15,
  },
  sensorTypeContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginHorizontal: 15,
    marginTop: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sensorTypeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sensorTypeButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 4,
    alignItems: 'center',
  },
  selectedButton: {
    backgroundColor: '#4361EE',
  },
  buttonText: {
    fontWeight: '500',
    color: '#333',
  },
  selectedButtonText: {
    color: '#fff',
  },
  sensorInfoContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginHorizontal: 15,
    marginTop: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sensorInfoText: {
    fontSize: 16,
    marginVertical: 4,
    color: '#333',
  }
});

export default StartSensorScreen; 