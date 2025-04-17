import React, { useEffect } from 'react';
import { Platform, StatusBar as RNStatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native';
import { Header } from '@react-navigation/elements';

// Auth screens
import SignUpScreen from '../screens/auth/SignUpScreen';
import SignInScreen from '../screens/auth/SignInScreen';
import EmailVerificationScreen from '../screens/auth/EmailVerificationScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';

// Main app screens
import TabNavigator from './TabNavigator';
import StartSensorScreen from '../screens/sensor/StartSensorScreen';

export type RootStackParamList = {
  // Auth Stack
  SignUp: undefined;
  SignIn: undefined;
  EmailVerification: undefined;
  ForgotPassword: undefined;
  ResetPassword: { code?: string };
  
  // Main App
  MainApp: undefined;
  StartSensor: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, loading } = useAuth();

  // Set status bar configuration
  useEffect(() => {
    if (Platform.OS === 'android') {
      RNStatusBar.setTranslucent(true);
      RNStatusBar.setBackgroundColor('transparent');
    }
  }, []);

  // Debug logging to help diagnose issues
  React.useEffect(() => {
    if (user) {
      console.log("Navigation: User state changed:", user.email, 
                  "Verified:", user.emailVerified);
    }
  }, [user]);

  if (loading) {
    return null; // You could return a spinner/loading screen here
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator 
        screenOptions={{ 
          headerShown: false,
          headerStyle: {
            backgroundColor: '#f8f9fa',
          },
          headerTitleStyle: {
            fontWeight: 'bold',
            color: '#333',
          },
          headerTintColor: '#333',
          contentStyle: {
          }
        }}
      >
        {user ? (
          user.emailVerified ? (
            <>
              <Stack.Screen name="MainApp">
                {(props) => <TabNavigator {...props} />}
              </Stack.Screen>
              <Stack.Screen
                name="StartSensor"
                component={StartSensorScreen}
                options={{
                  headerShown: true,
                  title: 'Start Sensor',
                  headerShadowVisible: false,
                  header: (props) => (
                    <SafeAreaView style={{backgroundColor: '#f8f9fa'}}>
                      <Header 
                        {...props} 
                        title="Start Sensor" 
                      />
                    </SafeAreaView>
                  )
                }}
              />
            </>
          ) : (
            <Stack.Screen
              name="EmailVerification"
              component={EmailVerificationScreen}
            />
          )
        ) : (
          <>
            <Stack.Screen name="SignIn" component={SignInScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
