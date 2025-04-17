import React, { useEffect, useState } from 'react';
import { StyleSheet, SafeAreaView, View, Text } from 'react-native';
import { AuthProvider } from './context/AuthContext';
import Navigation from './navigation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import NfcService from './services/NfcService';

export default function App() {
  const [nfcInitialized, setNfcInitialized] = useState<boolean | null>(null);
  const [isExpoGo, setIsExpoGo] = useState<boolean | null>(null);
  
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
        
        // Initialize NFC
        console.log('[App] Initializing NFC at application startup');
        const nfcAvailable = await nfcService.initialize();
        console.log(`[App] NFC initialization ${nfcAvailable ? 'successful' : 'failed'}`);
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SafeAreaView style={styles.container}>
          {isExpoGo && (
            <View style={styles.expoGoWarning}>
              <Text style={styles.expoGoWarningText}>
                Running in Expo Go - NFC features are limited. Build a development build for full NFC support.
              </Text>
            </View>
          )}
          <Navigation />
        </SafeAreaView>
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
