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
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase/firebaseconfig';
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit, deleteDoc, doc, updateDoc, setDoc } from 'firebase/firestore';
import NfcManager from 'react-native-nfc-manager';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import SensorNfcService, { NfcErrorType, ISensorInfo } from '../../services/SensorNfcService';
import { NfcTech } from 'react-native-nfc-manager';
import NfcService from '../../services/NfcService';
import { SensorStatusService } from '../../services/SensorStatusService';
import GlucoseCalculationService from '../../services/GlucoseCalculationService';
import NfcScanGuide from '../../components/NfcScanGuide';

// Initialize NFC Manager
try {
  console.log('[StartSensorScreen] Initializing NFC Manager on import');
  NfcManager.start();
} catch (error) {
  console.error('[StartSensorScreen] Error initializing NFC Manager on import:', error);
}

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
  const navigation = useNavigation();
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
  
  // Add a ref to track if an NFC operation is in progress
  const nfcOperationInProgress = useRef(false);
  // Add a ref for cleanup function
  const cleanupRef = useRef<(() => void) | null>(null);
  
  // Fetch current active sensor on mount
  useEffect(() => {
    const fetchCurrentSensor = async () => {
      if (!user) return;
      
      try {
        console.log('[StartSensorScreen] Fetching current sensor for user:', user.uid);
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
            setCurrentSensor({
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
            });
            console.log(`[StartSensorScreen] Set active sensor with serial: ${data.serialNumber}`);
          } else {
            console.log(`[StartSensorScreen] Found sensor with status ${data.status}, not setting as current`);
          }
        } else {
          console.log('[StartSensorScreen] No sensor documents found for user');
          // No active sensor, but that's okay - just set to null
          setCurrentSensor(null);
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
  
  // Scan for a new sensor using NFC
  const handleScan = async () => {
    console.log('[StartSensorScreen] Scan button pressed, starting NFC scan process');
    
    // Check if an NFC operation is already in progress
    if (nfcOperationInProgress.current) {
      console.log('[StartSensorScreen] NFC operation already in progress, aborting');
      Alert.alert('Please Wait', 'An NFC operation is already in progress.');
      return;
    }
    
    // Check if another NFC operation is already in progress
    let isNfcBusy = false;
    try {
      const nfcCoreService = NfcService.getInstance();
      if (nfcCoreService && typeof nfcCoreService.isOperationInProgress === 'function') {
        isNfcBusy = nfcCoreService.isOperationInProgress();
      }
    } catch (error) {
      console.error('[StartSensorScreen] Error checking NFC service status:', error);
    }
    
    if (isNfcBusy) {
      console.log('[StartSensorScreen] NFC service reports operation in progress, aborting');
      Alert.alert('NFC Busy', 'Another NFC operation is in progress. Please wait a moment and try again.');
      return;
    }
    
    try {
      // First ensure any previous NFC sessions are cleaned up
      await ensureNfcCleanup();
      
      // Double-check if NFC is available
      let isNfcAvailable = false;
      try {
        console.log('[StartSensorScreen] Checking NFC availability before scanning');
        isNfcAvailable = await SensorNfcService.isNfcAvailable();
        console.log('[StartSensorScreen] Current NFC availability status:', isNfcAvailable);
        
        // Update state if changed
        if (nfcAvailable !== isNfcAvailable) {
          setNfcAvailable(isNfcAvailable);
        }
      } catch (error) {
        console.error('[StartSensorScreen] Error checking NFC availability:', error);
      }
      
      // Force a real-time check using NfcManager.isEnabled if available
      if (isNfcAvailable && Platform.OS === 'android') {
        try {
          if (typeof NfcManager.isEnabled === 'function') {
            const realTimeStatus = await NfcManager.isEnabled();
            console.log('[StartSensorScreen] Real-time NFC enabled status:', realTimeStatus);
            
            // Override previous check if this is more recent and accurate
            isNfcAvailable = realTimeStatus;
            setNfcAvailable(realTimeStatus);
          }
        } catch (error) {
          console.error('[StartSensorScreen] Error in real-time NFC status check:', error);
        }
      }
      
      if (!isNfcAvailable) {
        console.log('[StartSensorScreen] NFC is not available, showing alert');
        
        // First check if the device supports NFC at all
        let isNfcSupported = false;
        try {
          // This checks if the device has NFC hardware capability
          if (typeof NfcManager.isSupported === 'function') {
            isNfcSupported = await NfcManager.isSupported();
          }
        } catch (error) {
          console.error('[StartSensorScreen] Error checking NFC support:', error);
          isNfcSupported = false;
        }
        
        if (!isNfcSupported) {
          // Device doesn't support NFC at all
          Alert.alert(
            'NFC Not Supported',
            'Your device does not support NFC, which is required for scanning glucose sensors. Please use a device with NFC capability.',
            [{ text: 'OK' }]
          );
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
                    console.log('[StartSensorScreen] Opening NFC settings via intent...');
                    Linking.sendIntent('android.settings.NFC_SETTINGS')
                      .catch(error => {
                        console.error('[StartSensorScreen] Error with direct intent:', error);
                        // Fall back to NfcManager if direct intent fails
                        SensorNfcService.openNfcSettings().catch(e => 
                          console.error('[StartSensorScreen] All NFC settings methods failed:', e)
                        );
                      });
                  } catch (error) {
                    console.error('[StartSensorScreen] Error trying to open settings:', error);
                    // Try the service method as fallback
                    SensorNfcService.openNfcSettings().catch(e => 
                      console.error('[StartSensorScreen] Fallback NFC settings also failed:', e)
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
        }
        return;
      }
      
      // Set flag that NFC operation is in progress
      nfcOperationInProgress.current = true;
      
      console.log('[StartSensorScreen] Setting scanning state to true');
      setScanning(true);
      
      // Store cleanup function for component unmount
      cleanupRef.current = () => {
        NfcManager.cancelTechnologyRequest().catch(() => {});
        nfcOperationInProgress.current = false;
      };
      
      // Show the NFC scan guide
      setShowScanGuide(true);
      
      // Start the NFC scan directly without a confirmation dialog
      try {
        // Check if NfcManager exists before attempting to use it
        if (typeof NfcManager === 'undefined' || NfcManager === null) {
          console.error('[StartSensorScreen] NFC Manager is not available');
          throw new Error(NfcErrorType.NOT_SUPPORTED);
        }

        console.log('[StartSensorScreen] Requesting NFC V technology');
        // 1. Request NFC technology
        await NfcManager.requestTechnology(NfcTech.NfcV);
        
        // Hide the scan guide when we detect a tag
        setShowScanGuide(false);
        
        console.log('[StartSensorScreen] NFC technology granted, getting tag');
        // 2. Read tag information and sensor info
        const tag = await NfcManager.getTag();
        console.log('[StartSensorScreen] Retrieved tag information:', tag);
        
        if (!tag || !tag.id) {
          console.error('[StartSensorScreen] No tag ID found in scanned tag');
          throw new Error(NfcErrorType.TAG_NOT_FOUND);
        }
        
        // 3. Get detailed sensor information
        const sensorInfo = await nfcService.readSensorInfo();
        if (!sensorInfo) {
          console.error('[StartSensorScreen] Failed to read sensor information');
          throw new Error(NfcErrorType.COMMUNICATION_ERROR);
        }
        
        // 4. Extract serial number from sensor info
        const serialNumber = sensorInfo.uid || tag.id;
        console.log(`[StartSensorScreen] Extracted serial number: ${serialNumber}`);
        
        // 5. Extract manufacturer data if available
        const manufacturer = sensorInfo.manufacturerData ? 
          'Texas Instruments' : 'Texas Instruments'; // Default if not available
        const model = 'RF430FRL15xH CGM Sensor';
        
        // 6. Verify the sensor before activation
        setVerifyingSensor(true);
        await ensureNfcCleanup(); // Cleanup before testing
        
        // Show verification message
        Alert.alert(
          'Sensor Found',
          `Found sensor with serial number: ${serialNumber}. Verifying sensor functionality...`,
          [{ text: 'OK' }]
        );
        
        // Perform a test reading to verify the sensor works
        try {
          // Try to read from the sensor
          const adcValue = await nfcService.safeReadGlucoseSensor();
          
          if (adcValue > 0) {
            // Convert to glucose
            const glucoseValue = glucoseService.adcToGlucose(adcValue);
            
            setSensorTestResult({
              success: true,
              reading: glucoseValue
            });
            
            // Show confirmation with the real serial number and test reading
            Alert.alert(
              'Sensor Verified',
              `Found sensor with serial number: ${serialNumber}.\n\nTest reading: ${glucoseValue} mg/dL.\n\nDo you want to activate this sensor?`,
              [
                {
                  text: 'Cancel',
                  style: 'cancel',
                  onPress: async () => {
                    console.log('[StartSensorScreen] User cancelled sensor activation');
                    setScanning(false);
                    setVerifyingSensor(false);
                    setSensorTestResult(null);
                    await ensureNfcCleanup();
                  }
                },
                {
                  text: 'Activate',
                  onPress: async () => {
                    console.log('[StartSensorScreen] User confirmed sensor activation');
                    setVerifyingSensor(false);
                    // Clean up NFC before activating sensor
                    await ensureNfcCleanup();
                    activateSensor(serialNumber, manufacturer, model);
                  }
                }
              ]
            );
          } else {
            // Sensor reading failed
            setSensorTestResult({
              success: false,
              reading: null,
              error: 'Sensor did not provide a valid reading'
            });
            
            Alert.alert(
              'Sensor Verification Failed',
              'The sensor was detected but did not provide a valid reading. Do you want to try again or activate anyway?',
              [
                {
                  text: 'Cancel',
                  style: 'cancel',
                  onPress: async () => {
                    console.log('[StartSensorScreen] User cancelled sensor activation after failed test');
                    setScanning(false);
                    setVerifyingSensor(false);
                    setSensorTestResult(null);
                    await ensureNfcCleanup();
                  }
                },
                {
                  text: 'Try Again',
                  onPress: async () => {
                    console.log('[StartSensorScreen] User wants to try reading again');
                    setVerifyingSensor(false);
                    setSensorTestResult(null);
                    await ensureNfcCleanup();
                    // Call handleScan again
                    handleScan();
                  }
                },
                {
                  text: 'Activate Anyway',
                  onPress: async () => {
                    console.log('[StartSensorScreen] User activating sensor despite failed test');
                    setVerifyingSensor(false);
                    // Clean up NFC before activating sensor
                    await ensureNfcCleanup();
                    activateSensor(serialNumber, manufacturer, model);
                  }
                }
              ]
            );
          }
        } catch (testError) {
          console.error('[StartSensorScreen] Error testing sensor:', testError);
          setSensorTestResult({
            success: false,
            reading: null,
            error: testError instanceof Error ? testError.message : 'Unknown error testing sensor'
          });
          
          Alert.alert(
            'Sensor Test Failed',
            'There was an error testing the sensor. Do you want to try again or activate anyway?',
            [
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: async () => {
                  console.log('[StartSensorScreen] User cancelled after test error');
                  setScanning(false);
                  setVerifyingSensor(false);
                  setSensorTestResult(null);
                  await ensureNfcCleanup();
                }
              },
              {
                text: 'Try Again',
                onPress: async () => {
                  console.log('[StartSensorScreen] User wants to try scanning again after error');
                  setVerifyingSensor(false);
                  setSensorTestResult(null);
                  await ensureNfcCleanup();
                  // Call handleScan again
                  handleScan();
                }
              },
              {
                text: 'Activate Anyway',
                onPress: async () => {
                  console.log('[StartSensorScreen] User activating despite test error');
                  setVerifyingSensor(false);
                  // Clean up NFC before activating sensor
                  await ensureNfcCleanup();
                  activateSensor(serialNumber, manufacturer, model);
                }
              }
            ]
          );
        }
      } catch (error) {
        // Hide the scan guide when there's an error
        setShowScanGuide(false);
        
        console.error('[StartSensorScreen] Error during NFC scan:', error);
        
        let errorMessage = 'An error occurred while scanning the sensor.';
        
        // Handle specific error types
        if (error instanceof Error) {
          const errorString = error.toString();
          if (errorString.includes(NfcErrorType.CANCELLED)) {
            errorMessage = 'Scan was cancelled.';
            console.log('[StartSensorScreen] Scan was cancelled by user or timeout');
          } else if (errorString.includes(NfcErrorType.NOT_SUPPORTED)) {
            errorMessage = 'NFC is not supported on this device.';
            console.error('[StartSensorScreen] NFC is not supported on this device');
          } else if (errorString.includes(NfcErrorType.NOT_ENABLED)) {
            errorMessage = 'NFC is not enabled. Please enable NFC in your device settings.';
            console.error('[StartSensorScreen] NFC is not enabled on this device');
          } else if (errorString.includes(NfcErrorType.TAG_NOT_FOUND)) {
            errorMessage = 'No sensor found. Please try again and make sure the sensor is within range.';
            console.error('[StartSensorScreen] No tag found during scan');
          } else if (errorString.includes('one request at a time')) {
            errorMessage = 'Another NFC operation is in progress. Please wait a moment and try again.';
            console.error('[StartSensorScreen] Concurrent NFC request detected');
          } else {
            console.error('[StartSensorScreen] Unknown error during scan:', error);
          }
        } else {
          console.error('[StartSensorScreen] Non-Error object thrown during scan:', error);
        }
        
        Alert.alert('Scan Failed', errorMessage);
        setScanning(false);
        setVerifyingSensor(false);
      } finally {
        // Clean up NFC resources
        await ensureNfcCleanup();
      }
    } catch (error) {
      setShowScanGuide(false);
      console.error('[StartSensorScreen] Unexpected error during scan initialization:', error);
      Alert.alert('Error', 'Failed to initialize sensor scan.');
      setScanning(false);
      setVerifyingSensor(false);
      await ensureNfcCleanup();
    }
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
  
  // Activate a new sensor
  const activateSensor = async (serialNumber: string, manufacturer: string, model: string) => {
    if (!user) return;
    
    setScanning(false);
    setProcessing(true);
    
    try {
      // If there's an active sensor, mark it as removed
      if (currentSensor?.id) {
        await deactivateCurrentSensor();
      }
      
      // Calculate expiration date (14 days from now for most CGM sensors)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      
      // Add new sensor to Firestore
      const sensorsRef = collection(db, 'users', user.uid, 'sensors');
      const newSensor = {
        serialNumber,
        startedAt: now,
        expiresAt,
        manufacturer,
        model,
        status: 'active',
        createdAt: serverTimestamp(),
        lastReading: sensorTestResult?.reading || null,
        lastReadingTime: sensorTestResult?.success ? now : null,
        batteryLevel: 100, // Assume full battery for new sensor
      };
      
      const docRef = await addDoc(sensorsRef, newSensor);
      
      // Also store sensor information in the main sensors collection
      const mainSensorRef = doc(db, 'sensors', serialNumber);
      await setDoc(mainSensorRef, {
        serialNumber,
        userId: user.uid,
        activationDate: now,
        expirationDate: expiresAt,
        manufacturer,
        model,
        status: 'active',
        lastScanTime: now,
        batteryLevel: 100,
        lastReading: sensorTestResult?.reading || null,
        lastReadingTime: sensorTestResult?.success ? now : null,
        isExpired: false,
        isExpiringSoon: false,
        hasLowBattery: false,
      });
      
      // Update state
      setCurrentSensor({
        id: docRef.id,
        serialNumber,
        startedAt: now,
        expiresAt,
        manufacturer,
        model,
        status: 'active',
        lastReading: sensorTestResult?.reading || null,
        lastReadingTime: sensorTestResult?.success ? now : null,
        batteryLevel: 100,
      });
      
      // Update sensor status service
      await sensorStatusService.activateSensor(serialNumber, user.uid);
      
      // Success notification
      Alert.alert(
        'Sensor Activated',
        'Your new sensor has been successfully activated. It will expire in 14 days.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Optionally navigate to home screen
              // navigation.navigate('Home');
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error activating sensor:', error);
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
      
      // Also update the main sensors collection
      if (currentSensor.serialNumber) {
        const mainSensorRef = doc(db, 'sensors', currentSensor.serialNumber);
        await updateDoc(mainSensorRef, {
          status: 'removed',
          isConnected: false,
          removedAt: new Date(),
        });
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
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sensor Management</Text>
        </View>
        
        {/* Current Sensor Info */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Current Sensor</Text>
          
          {currentSensor ? (
            <View style={styles.sensorInfoContainer}>
              <View style={styles.sensorIconContainer}>
                <Ionicons name="radio-outline" size={36} color="#4361EE" />
              </View>
              
              <View style={styles.sensorDetails}>
                <Text style={styles.sensorModel}>{currentSensor.model}</Text>
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
              disabled={scanning || processing}
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
      
      {/* NFC Scan Guide Modal */}
      <NfcScanGuide
        visible={showScanGuide}
        onTimeout={handleScanTimeout}
        timeoutDuration={30000}
        message="Hold your phone near the sensor to scan"
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
  sensorInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f3ff',
    borderRadius: 10,
    padding: 15,
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
  sensorModel: {
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
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
});

export default StartSensorScreen; 