import React, { useEffect, useState } from 'react';
import { StyleSheet, SafeAreaView, View, Text } from 'react-native';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navigation from './navigation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import NfcService from './services/NfcService';
import NfcManager from 'react-native-nfc-manager';
import { Platform } from 'react-native';
import AlertModal from './components/AlertModal';
import AlertService, { GlucoseAlert } from './services/AlertService';
import MeasurementService from './services/MeasurementService';
import NotesService from './services/NotesService';

// Pre-initialize NFC Manager as early as possible
// This helps prevent the Android system from stealing NFC tag handling
if (Platform.OS === 'android') {
  try {
    console.log('[App] Starting NFC Manager initialization on app load');
    NfcManager.start();
    console.log('[App] NFC Manager started successfully');
  } catch (error) {
    console.error('[App] Error starting NFC Manager:', error);
  }
}

// Internal app component that has access to the auth context
const AppContent = () => {
  const [nfcInitialized, setNfcInitialized] = useState<boolean | null>(null);
  const [isExpoGo, setIsExpoGo] = useState<boolean | null>(null);
  const [currentAlert, setCurrentAlert] = useState<GlucoseAlert | null>(null);
  const { user } = useAuth();
  
  // Initialize connectivity monitoring services for logged-in user
  useEffect(() => {
    if (user) {
      console.log('[App] Initializing measurement and notes connectivity monitoring for user:', user.uid);
      // Initialize measurement service connectivity monitoring
      MeasurementService.initConnectivityMonitoring(user.uid);
      // Initialize notes service connectivity monitoring
      NotesService.initConnectivityMonitoring(user.uid);
      
      // Clean up when user logs out or component unmounts
      return () => {
        console.log('[App] Stopping measurement and notes connectivity monitoring');
        MeasurementService.stopConnectivityMonitoring();
        NotesService.stopConnectivityMonitoring();
      };
    }
  }, [user]);
  
  // Initialize AlertService
  useEffect(() => {
    const alertService = AlertService.getInstance();
    
    // Register callback to show alert modal when an alert is triggered
    alertService.registerAlertCallback((alert: GlucoseAlert) => {
      console.log('[App] Alert triggered:', alert);
      setCurrentAlert(alert);
    });
    
    // Clean up when component unmounts
    return () => {
      alertService.unregisterAlertCallback();
      // Release sound resources when unmounting
      alertService.releaseResources().catch(error => {
        console.error('[App] Error releasing alert sound resources:', error);
      });
    };
  }, []);
  
  // Handle alert dismissal
  const handleAlertDismiss = () => {
    const alertService = AlertService.getInstance();
    
    // Stop the alarm sound
    alertService.stopAlarm();
    
    // Save the alert to history
    if (currentAlert && user) {
      // Make sure userId is added to the reading
      const readingWithUserId = {
        ...currentAlert.reading,
        userId: user.uid
      };
      
      // Update the alert with user ID
      const alertWithUserId = {
        ...currentAlert,
        reading: readingWithUserId
      };
      
      // Save the alert to history
      alertService.saveAlertToHistory(alertWithUserId);
    }
    
    // Clear the current alert
    setCurrentAlert(null);
  };
  
  // Initialize NFC when the app starts
  useEffect(() => {
    const initializeNfc = async () => {
      try {
        const nfcService = NfcService.getInstance();
        
        // Check if running in Expo Go
        const expoGoCheck = nfcService.isRunningInExpoGo();
        setIsExpoGo(expoGoCheck);
        
        if (expoGoCheck) {
          console.log('[App] Running in Expo Go - NFC features will be limited');
          setNfcInitialized(false);
          return;
        }
        
        // Initialize NFC but don't enable foreground dispatch yet
        console.log('[App] Initializing NFC at application startup');
        const nfcAvailable = await nfcService.initialize();
        console.log(`[App] NFC initialization ${nfcAvailable ? 'successful' : 'failed'}`);
        
        // Force cancel any technology requests but DON'T enable tag reading yet
        if (nfcAvailable) {
          await nfcService.forceCancelTechnologyRequest();
          
          // Make sure foreground dispatch is NOT enabled
          try {
            await nfcService.disableForegroundDispatch();
          } catch (error) {
            console.error('[App] Error disabling foreground dispatch:', error);
          }
        }
        
        setNfcInitialized(nfcAvailable);
      } catch (error) {
        console.error('[App] Error initializing NFC:', error);
        setNfcInitialized(false);
      }
    };
    
    initializeNfc();
    
    // Clean up NFC when the app is closed
    return () => {
      const nfcService = NfcService.getInstance();
      nfcService.cleanup().catch(error => {
        console.error('[App] Error cleaning up NFC:', error);
      });
    };
  }, []);
  
  return (
    <SafeAreaView style={styles.container}>
      {isExpoGo && (
        <View style={styles.expoGoWarning}>
          <Text style={styles.expoGoWarningText}>
            Running in Expo Go - NFC features are limited. Build a development build for full NFC support.
          </Text>
        </View>
      )}
      <Navigation />
      
      {/* Alert Modal */}
      <AlertModal 
        alert={currentAlert}
        onDismiss={handleAlertDismiss}
      />
    </SafeAreaView>
  );
};

// Main App component that provides the auth context
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  expoGoWarning: {
    backgroundColor: '#FFF3CD',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#FFE69C',
  },
  expoGoWarningText: {
    color: '#856404',
    fontSize: 12,
    textAlign: 'center',
  },
});
