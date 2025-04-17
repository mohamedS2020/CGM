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
  Linking,
  Switch
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { LineChart } from 'react-native-chart-kit';
import NfcManager from 'react-native-nfc-manager';
import MeasurementService, { GlucoseReading } from '../../services/MeasurementService';
import SensorNfcService, { NfcErrorType } from '../../services/SensorNfcService';
import GlucoseCalculationService from '../../services/GlucoseCalculationService';
import GlucoseMonitoringService from '../../services/GlucoseMonitoringService';
import NfcService from '../../services/NfcService';

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
  const [monitoring, setMonitoring] = useState(false);
  const [monitoringInterval, setMonitoringInterval] = useState(5 * 60 * 1000); // 5 minutes default
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);
  const [nfcEnabled, setNfcEnabled] = useState<boolean | null>(null);
  
  // References
  const appStateRef = useRef(AppState.currentState);
  const nfcCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get service instances
  const nfcService = SensorNfcService.getInstance();
  const glucoseCalculationService = GlucoseCalculationService.getInstance();
  const monitoringService = GlucoseMonitoringService.getInstance();

  // Fetch glucose readings
  const fetchGlucoseReadings = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // Get readings using the service
      const readings = await MeasurementService.getReadings(user.uid, { 
        timeframe: 'week',
        limit: 100 
      });
      
      setGlucoseReadings(readings);
      
      if (readings.length > 0) {
        setLastReading(readings[0]);
      } else {
        // If no readings, create mock data for testing
        const mockReading = MeasurementService.createMockReading();
        setLastReading(mockReading);
        
        // Add some mock data if no readings exist
        if (process.env.NODE_ENV === 'development') {
          createMockData();
        }
      }
    } catch (error) {
      console.error('Error fetching glucose readings:', error);
      Alert.alert('Error', 'Failed to fetch glucose readings');
    } finally {
      setLoading(false);
    }
  };

  // Create mock data for development
  const createMockData = async () => {
    if (!user) return;
    
    try {
      // Create and add 50 mock readings
      for (let i = 0; i < 50; i++) {
        const mockReading = MeasurementService.createMockReading();
        
        // Set timestamp to be i hours ago
        const now = new Date();
        mockReading.timestamp = new Date(now.getTime() - i * 3600000);
        
        // Add to Firestore
        await MeasurementService.addReading(user.uid, mockReading);
      }
      
      // Fetch again to get the saved data
      await fetchGlucoseReadings();
    } catch (error) {
      console.error('Error creating mock data:', error);
    }
  };
  
  // Take a manual sensor reading
  const handleManualReading = async () => {
    // Check if already scanning
    if (scanning) {
      Alert.alert('Scan in Progress', 'A scan is already in progress. Please wait for it to complete.');
      return;
    }
    
    try {
      setScanning(true);
      
      // First check if NFC is available
      let isNfcAvailable = false;
      try {
        isNfcAvailable = await SensorNfcService.isNfcAvailable();
        console.log('Current NFC availability status:', isNfcAvailable);
      } catch (error) {
        console.error('Error checking NFC availability:', error);
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
        return;
      }
      
      // Check if NFC service is already performing an operation
      let isNfcBusy = false;
      try {
        const nfcCoreService = NfcService.getInstance();
        if (nfcCoreService && typeof nfcCoreService.isOperationInProgress === 'function') {
          isNfcBusy = nfcCoreService.isOperationInProgress();
        }
      } catch (error) {
        console.error('Error checking NFC service status:', error);
      }
      
      if (isNfcBusy) {
        Alert.alert(
          'NFC Busy',
          'Another NFC operation is in progress. Please wait a moment and try again.',
          [{ text: 'OK' }]
        );
        setScanning(false);
        return;
      }
      
      // Try to take a manual reading using the monitoring service
      if (user) {
        try {
          // Set the user ID if monitoring is not active yet
          if (!monitoringService.isMonitoring()) {
            monitoringService.startMonitoring(
              user.uid, 
              monitoringInterval,
              handleNewReading,
              handleMonitoringError
            );
            // We don't set monitoring state here because we're just taking a manual reading
          }
          
          // Take a manual reading
          const reading = await monitoringService.takeManualReading();
          
          // Update state with new reading (handleNewReading will be called by the service)
          
          // Show success message
          Alert.alert(
            'Reading Complete',
            `Your glucose level is ${reading.value} mg/dL.`,
            [{ text: 'OK' }]
          );
        } catch (error) {
          console.error('Error taking manual reading:', error);
          
          if (error instanceof Error) {
            // Handle specific error messages
            const errorMessage = error.message;
            
            if (errorMessage.includes('CONCURRENT_OPERATION') || 
                errorMessage.includes('another NFC operation')) {
              Alert.alert(
                'NFC Busy',
                'Another NFC operation is in progress. Please wait a moment and try again.',
                [{ text: 'OK' }]
              );
            } else if (errorMessage.includes('NOT_SUPPORTED')) {
              Alert.alert(
                'NFC Not Supported', 
                'It appears your device does not support NFC or it is currently disabled.'
              );
            } else if (errorMessage.includes('TAG_NOT_FOUND')) {
              Alert.alert(
                'Sensor Not Found', 
                'No glucose sensor was detected. Place your CGM sensor directly against the back of your phone and try again.',
                [{ 
                  text: 'OK',
                  onPress: () => {
                    Alert.alert(
                      'Testing Mode',
                      'Are you running this app in testing mode without a physical sensor? In a production environment, a compatible glucose sensor is required.',
                      [
                        { text: 'I Understand', style: 'default' }
                      ]
                    );
                  } 
                }]
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
                'Unable to read from sensor. This error is common when no sensor is present or the sensor is not positioned correctly.',
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
      console.error('Error initiating NFC scan:', error);
      Alert.alert('Error', 'Failed to initiate sensor scan. Please check if NFC is supported and enabled on your device.');
    } finally {
      setScanning(false);
    }
  };

  // Toggle monitoring status
  const handleMonitoringToggle = async () => {
    try {
      if (!monitoring) {
        // Check NFC availability first
        const nfcAvailable = await SensorNfcService.isNfcAvailable();
        if (!nfcAvailable) {
          Alert.alert(
            "NFC Not Available",
            "This device does not support NFC or NFC is disabled. Please enable NFC in your device settings to use continuous glucose monitoring.",
            [{ text: "OK" }]
          );
          return;
        }
        
        // Start monitoring
        startMonitoring();
      } else {
        // Stop monitoring
        stopMonitoring();
      }
    } catch (error) {
      console.error('Error toggling monitoring:', error);
      Alert.alert(
        "Error",
        "An error occurred while toggling glucose monitoring. Please try again.",
        [{ text: "OK" }]
      );
    }
  };
  
  // Start continuous monitoring
  const startMonitoring = async () => {
    try {
      // Check if user exists
      if (!user) {
        Alert.alert("Error", "User not authenticated. Please sign in to start monitoring.");
        return;
      }
      
      // Start the monitoring service
      const result = await monitoringService.startMonitoring(
        user.uid, 
        monitoringInterval, // use the selected interval from state
        (reading) => {
          // Handle new reading
          console.log('New glucose reading:', reading);
          handleNewReading(reading);
        },
        (error) => {
          // Handle errors
          console.error('Monitoring error:', error);
          if (error.message === 'NFC_NOT_AVAILABLE') {
            Alert.alert(
              "NFC Not Available",
              "NFC is required for glucose monitoring but is not available on this device or is disabled.",
              [{ text: "OK" }]
            );
            setMonitoring(false);
          } else if (error.message === 'NFC_NOT_ENABLED') {
            Alert.alert(
              "NFC Not Enabled",
              "Please enable NFC in your device settings to continue glucose monitoring.",
              [{ text: "OK" }]
            );
            setMonitoring(false);
          } else if (error.message === 'SENSOR_NOT_FOUND') {
            Alert.alert(
              "Sensor Not Found",
              "Could not detect a glucose sensor. Please ensure your sensor is properly applied and try again.",
              [{ text: "OK" }]
            );
            setMonitoring(false);
          }
        }
      );
      
      if (result === true) {
        setMonitoring(true);
        Alert.alert("Monitoring Started", "Continuous glucose monitoring has been activated.");
      } else if (result === 'SENSOR_NOT_FOUND') {
        Alert.alert(
          "Sensor Not Found", 
          "Could not detect a glucose sensor. Please ensure your sensor is properly applied and try again."
        );
      } else if (result === 'ALREADY_MONITORING') {
        Alert.alert("Monitoring Active", "Continuous glucose monitoring is already active.");
        setMonitoring(true); // Make sure UI reflects actual state
      } else {
        // Fix the error message formatting to avoid showing {object Object}
        const errorMessage = typeof result === 'string' ? result : 'Unknown error';
        Alert.alert("Monitoring Error", `Could not start glucose monitoring. ${errorMessage}`);
      }
    } catch (error) {
      console.error('Error starting monitoring:', error);
      Alert.alert(
        "Error",
        "An error occurred while starting glucose monitoring. Please try again.",
        [{ text: "OK" }]
      );
    }
  };

  // Stop continuous monitoring
  const stopMonitoring = () => {
    try {
      monitoringService.stopMonitoring();
      setMonitoring(false);
      Alert.alert("Monitoring Stopped", "Continuous glucose monitoring has been deactivated.");
    } catch (error) {
      console.error('Error stopping monitoring:', error);
      Alert.alert(
        "Error",
        "An error occurred while stopping glucose monitoring. Please try again.",
        [{ text: "OK" }]
      );
    }
  };
  
  // Change monitoring interval
  const changeMonitoringInterval = (minutes: number) => {
    const intervalMs = minutes * 60 * 1000;
    setMonitoringInterval(intervalMs);
    
    if (monitoringService.isMonitoring()) {
      monitoringService.setMonitoringInterval(intervalMs);
      Alert.alert(
        'Interval Updated',
        `Monitoring interval has been updated to ${minutes} minutes.`
      );
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
    console.error('Monitoring error:', error);
    
    // Provide user-friendly feedback for common errors
    if (error.message.includes('TAG_NOT_FOUND')) {
      // This is expected when no sensor is connected - don't show an alert
      console.log('No sensor was detected during monitoring - this is normal if no sensor is present');
    } else if (error.message.includes('COMMUNICATION_ERROR')) {
      // Only show an alert for communication errors if monitoring is active
      if (monitoring) {
        Alert.alert(
          'Communication Error',
          'Unable to read from sensor. Please make sure your sensor is properly positioned.',
          [{ text: 'OK' }]
        );
      }
    } else if (error.message.includes('CANCELLED')) {
      // User cancelled the scan, no need to show an alert
      console.log('Sensor scan was cancelled by the user');
    } else if (monitoring) {
      // For other errors, only alert if monitoring is active
      Alert.alert(
        'Reading Error',
        'There was a problem reading your glucose sensor. Please try again.',
        [{ text: 'OK' }]
      );
    }
    
    // Check if monitoring is still active
    if (!monitoringService.isMonitoring()) {
      setMonitoring(false);
    }
  };

  // Filter readings based on selected timeframe
  const getFilteredReadings = (): GlucoseReading[] => {
    if (!glucoseReadings.length) return [];
  
    const now = new Date();
    let cutoffTime: Date;
  
    switch (chartTimeframe) {
      case 'hour':
        cutoffTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
        break;
      case 'week':
        cutoffTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
        break;
      case 'day':
      default:
        cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
        break;
    }
  
    return glucoseReadings
      .filter(reading => {
        const ts = new Date(reading.timestamp);
        return !isNaN(ts.getTime()) && ts >= cutoffTime;
      })
      .map(reading => ({
        ...reading,
        timestamp: new Date(reading.timestamp), // Force it to a Date object
      }));
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
      labels: sortedReadings.map(reading => {
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
          return `${date.getHours().toString().padStart(2, '0')}:00`;
        }
      }),
      datasets: [
        {
          data: sortedReadings.map(reading => {
            const value = reading.value;
            return Number.isFinite(value) ? value : 0; // Sanitize value
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
        // Check if device supports NFC - this is now handled by the NFC status check effect
        
        // Use a single initialization attempt to avoid race conditions
        if (nfcService) {
          console.log('Starting NFC initialization...');
          try {
            await nfcService.initialize();
            console.log('NFC initialization completed');
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
      
      // Safely clean up NFC
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
    const checkMonitoringStatus = () => {
      setMonitoring(monitoringService.isMonitoring());
    };
    
    // Add app state change listener
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (appStateRef.current !== 'active' && nextAppState === 'active') {
        // Check monitoring status
        checkMonitoringStatus();
        
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
      }
      appStateRef.current = nextAppState;
    });
    
    return () => {
      subscription.remove();
    };
  }, []);

  // Render monitoring controls
  const renderMonitoringControls = () => {
    // Store the interval options
    const intervalOptions = [
      { label: '5 min', value: 5 * 60 * 1000 },
      { label: '10 min', value: 10 * 60 * 1000 },
      { label: '15 min', value: 15 * 60 * 1000 },
      { label: '30 min', value: 30 * 60 * 1000 },
    ];

    // Check if NFC is available for monitoring
    const isNfcAvailable = nfcSupported === true && nfcEnabled === true;
    const monitoringDisabled = !isNfcAvailable || scanning;

    return (
      <View style={styles.monitoringContainer}>
        <View style={styles.monitoringHeader}>
          <Text style={styles.monitoringTitle}>Continuous Monitoring</Text>
          <Switch
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={monitoring ? '#2F80ED' : '#f4f3f4'}
            ios_backgroundColor="#3e3e3e"
            onValueChange={handleMonitoringToggle}
            value={monitoring}
            disabled={monitoringDisabled}
          />
        </View>
        
        {!isNfcAvailable && (
          <View style={styles.warningContainer}>
            <Text style={styles.warningText}>
              {nfcSupported === false 
                ? 'Continuous monitoring requires NFC, which is not supported on this device.' 
                : 'Please enable NFC to use continuous monitoring.'}
            </Text>
          </View>
        )}

        <Text style={styles.monitoringLabel}>Scan Interval:</Text>
        <View style={styles.intervalButtons}>
          {intervalOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.intervalButton,
                monitoringInterval === option.value && styles.intervalButtonActive,
                monitoringDisabled && styles.buttonDisabled
              ]}
              onPress={() => setMonitoringInterval(option.value)}
              disabled={monitoringDisabled}
            >
              <Text
                style={[
                  styles.intervalButtonText,
                  monitoringInterval === option.value && styles.intervalButtonTextActive,
                  monitoringDisabled && styles.buttonTextDisabled
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

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
      
      {/* Glucose History Chart */}
      <View style={styles.chartContainer}>
        {glucoseReadings.length > 0 ? (
          <LineChart
            data={getChartData()}
            width={screenWidth - 40}
            height={220}
            chartConfig={{
              backgroundColor: '#ffffff',
              backgroundGradientFrom: '#ffffff',
              backgroundGradientTo: '#ffffff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(67, 97, 238, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              style: {
                borderRadius: 16,
              },
              propsForDots: {
                r: '5',
                strokeWidth: '2',
                stroke: '#4361EE',
              },
              propsForBackgroundLines: {
                stroke: '#E0E7FF',
                strokeWidth: 1,
              },
              formatYLabel: (yValue) => {
                // Prevent invalid values from being displayed
                if (!yValue || yValue === 'undefined' || yValue === 'NaN' || yValue.includes('Infinity')) {
                  return '0';
                }
                const numValue = parseFloat(yValue);
                if (!Number.isFinite(numValue) || numValue === Infinity || numValue === -Infinity) {
                  return '0';
                }
                return yValue;
              },
              formatXLabel: (xLabel) => {
                return String(xLabel || '').substring(0, 5);
              }
            }}
            bezier
            style={styles.chart}
            yAxisLabel=""
            yAxisSuffix=" mg/dL"
            withDots={getFilteredReadings().length < 24}
            withInnerLines={true}
            withOuterLines={true}
            withHorizontalLines={true}
            withVerticalLines={false}
          />
        ) : (
          <View style={styles.noChartDataContainer}>
            <Text style={styles.noChartDataText}>No glucose history available</Text>
          </View>
        )}
      </View>
      
      {/* NFC Scan Button */}
      <TouchableOpacity 
        style={styles.scanButton}
        onPress={handleManualReading}
        disabled={scanning}
      >
        {scanning ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.scanButtonText}>Scan Sensor</Text>
        )}
      </TouchableOpacity>
      
      {/* Continuous Monitoring Controls */}
      {renderMonitoringControls()}
      
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
  chartControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginHorizontal: 20,
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
    color: '#4361EE',
  },
  activeTimeframeText: {
    color: 'white',
  },
  chartContainer: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  chart: {
    borderRadius: 16,
    paddingRight: 20,
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
  scanButton: {
    backgroundColor: '#4CC9F0',
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 28,
    marginHorizontal: 40,
    marginVertical: 30,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  scanButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
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
  monitoringHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  monitoringTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  monitoringLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  intervalButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  intervalButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#eee',
    marginHorizontal: 2,
  },
  intervalButtonActive: {
    backgroundColor: '#4361EE',
  },
  intervalButtonText: {
    fontSize: 12,
    color: '#666',
  },
  intervalButtonTextActive: {
    color: 'white',
  },
  warningContainer: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeeba',
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
    marginVertical: 10,
  },
  warningText: {
    color: '#856404',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
    backgroundColor: '#f0f0f0',
  },
  buttonTextDisabled: {
    color: '#999',
  },
  nfcStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 6,
    marginBottom: 15,
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