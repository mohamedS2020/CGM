import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  Image
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { Ionicons } from '@expo/vector-icons';

// Key for temp password storage
const TEMP_PASSWORD_KEY = 'cgm_temp_password';

const EmailVerificationScreen = () => {
  const { user, sendVerificationEmail, logout } = useAuth();
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  // Start countdown for resend button
  useEffect(() => {
    if (countdown > 0 && !canResend) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0 && !canResend) {
      setCanResend(true);
    }
  }, [countdown, canResend]);

  // Check if email is verified on component mount and periodically
  useEffect(() => {
    const checkEmailVerification = async () => {
      if (user) {
        setChecking(true);
        try {
          // Force reload the user to get the latest verification status
          await user.reload();
          const currentUser = auth.currentUser;
          
          if (currentUser?.emailVerified) {
            console.log("Email verified, updating token...");
            // Force refresh the auth state
            await currentUser.getIdToken(true);
            
            // This is important: force a state update in the component 
            // to trigger the navigation change
            Alert.alert(
              'Success', 
              'Your email has been verified! Redirecting to home...',
              [{ text: 'OK' }]
            );
            
            // Explicitly log the user out and back in to refresh all auth states
            const userEmail = currentUser.email;
            const userPassword = await AsyncStorage.getItem(TEMP_PASSWORD_KEY);
            
            if (userEmail && userPassword) {
              // Re-authenticate to refresh the auth state completely
              try {
                // Sign out first to clear any cached state
                await auth.signOut();
                
                // Small delay to ensure signOut completes
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Sign back in with the stored credentials
                await signInWithEmailAndPassword(auth, userEmail, userPassword);
                console.log("Re-authenticated successfully");
                
                // Clean up stored password
                await AsyncStorage.removeItem(TEMP_PASSWORD_KEY);
              } catch (authError) {
                console.error("Failed to re-authenticate:", authError);
                // Even if re-auth fails, manually set the emailVerified flag
                // This is a fallback to ensure the UI updates correctly
                if (auth.currentUser) {
                  // Force a manual navigation update by forcing an auth state change
                  const currentUser = auth.currentUser;
                  // This trick triggers a state refresh in the auth context
                  await currentUser.getIdToken(true);
                }
              }
            } else {
              // If we don't have the password, we need another way to update the auth state
              console.log("No stored password, attempting to force auth refresh");
              if (auth.currentUser) {
                // Force update by getting a fresh token
                await auth.currentUser.getIdToken(true);
                // Force reload one more time to ensure any NavStack changes
                await auth.currentUser.reload();
              }
            }
          }
        } catch (error) {
          console.error("Error reloading user:", error);
        } finally {
          setChecking(false);
        }
      }
    };

    // Check immediately on mount
    checkEmailVerification();

    // Setup interval for checking more frequently
    const intervalId = setInterval(checkEmailVerification, 3000);

    return () => {
      clearInterval(intervalId);
      // Clear any remaining timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [user, timeoutId]);

  const handleManualVerificationCheck = async () => {
    if (checking) return;
    
    setChecking(true);
    try {
      await user?.reload();
      const currentUser = auth.currentUser;
      
      if (currentUser?.emailVerified) {
        Alert.alert(
          'Success', 
          'Your email has been successfully verified! Redirecting to home...',
          [{ text: 'OK' }]
        );
        
        // Force refresh the token which will trigger auth state change
        await currentUser.getIdToken(true);
        
        // Get stored credentials for re-authentication
        const userEmail = currentUser.email;
        const userPassword = await AsyncStorage.getItem(TEMP_PASSWORD_KEY);
        
        if (userEmail && userPassword) {
          try {
            // Sign out and back in to fully refresh the auth state
            await auth.signOut();
            await new Promise(resolve => setTimeout(resolve, 500));
            await signInWithEmailAndPassword(auth, userEmail, userPassword);
            await AsyncStorage.removeItem(TEMP_PASSWORD_KEY);
          } catch (error) {
            console.error("Failed to re-authenticate:", error);
            // Forcibly refresh the token
            if (auth.currentUser) {
              await auth.currentUser.getIdToken(true);
            }
          }
        }
      } else {
        Alert.alert(
          'Not Verified',
          'Your email is not yet verified. Please check your inbox and click the verification link.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to check verification status');
    } finally {
      setChecking(false);
    }
  };

  const handleResendEmail = async () => {
    if (refreshing) return;
    
    try {
      setRefreshing(true);
      await sendVerificationEmail();
      setCanResend(false);
      setCountdown(60);
      
      // Set a timeout to auto-check after 15 seconds
      const newTimeoutId = setTimeout(() => {
        handleManualVerificationCheck();
      }, 15000);
      
      setTimeoutId(newTimeoutId);
      
      Alert.alert(
        'Email Sent', 
        'Verification email sent successfully. Please check your inbox and spam folder.'
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send verification email');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to sign out');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Image 
          source={require('../../assets/logo.png')} 
          style={styles.image}
          defaultSource={require('../../assets/logo.png')}
        />
        
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.description}>
          We've sent a verification email to:
        </Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.instruction}>
          Please check your inbox and spam folder, then click the verification link to continue.
        </Text>

        <TouchableOpacity
          style={[
            styles.checkButton,
            checking && styles.buttonDisabled,
          ]}
          onPress={handleManualVerificationCheck}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Check Verification Status</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.resendButton,
            (!canResend || refreshing) && styles.buttonDisabled,
          ]}
          onPress={handleResendEmail}
          disabled={!canResend || refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.resendButtonText}>
              {canResend 
                ? 'Resend Verification Email' 
                : `Resend in ${countdown}s`}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 350,
    alignItems: 'center',
  },
  image: {
    width: 180,
    height: 180,
    marginBottom: 25,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  email: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4361EE',
    marginBottom: 24,
  },
  instruction: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  checkButton: {
    backgroundColor: '#4361EE',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
  },
  resendButton: {
    backgroundColor: '#6B7FD7',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#B8C1EC',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  resendButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  signOutButton: {
    marginTop: 20,
  },
  signOutButtonText: {
    color: '#F72585',
    fontSize: 16,
  },
});

export default EmailVerificationScreen; 